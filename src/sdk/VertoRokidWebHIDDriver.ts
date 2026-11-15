import {PluginListenerHandle} from '@capacitor/core';
import * as THREE from 'three';
import {RokidWebHIDState, WebHIDConnectionStatus} from '../types.ts';
import {
  decodeBase64ToDataView,
  isRokidAndroidNativeAvailable,
  RokidUsbBatchEvent,
  RokidUsbNative,
} from './RokidAndroidUsbBridge.ts';

export const ROKID_VENDOR_ID = 0x04d2;

export type RokidTransportMode = 'webhid' | 'android-usb' | 'unsupported';

export const ROKID_MAX_PRODUCT_NAMES: Record<number, string> = {
  0x162f: 'Rokid Max (1st Gen)',
  0x162d: 'Rokid Max / Air Bridge',
  0x1630: 'Rokid Max (1st Gen Rev B)',
  0x1631: 'Rokid Max IMU',
  0x1632: 'Rokid Max Telemetry',
  0x1639: 'Rokid Max Series',
  0x2002: 'Rokid Air / Max Legacy',
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const GRAVITY = 9.80665;

// Sanity bounds — malformed packets must never reach the AHRS.
// (The previous int16 misparse fed a constant 25 rad/s into Madgwick,
//  which spun the view like a carousel.)
const MAX_GYRO_RAD_S = 35; // ±2000°/s-class IMU with headroom
const MIN_ACCEL_MPS2 = 6; // ~0.6 g floor
const MAX_ACCEL_MPS2 = 14; // ~1.4 g ceiling

// Frame corrections, verified by offline simulation of this exact filter:
// Rokid device frame is X-right/Y-up/Z-back, the filter's gravity convention
// is Z-down. Input gets Rx(-90°): (x,y,z) -> (x, z, -y) so the filter starts
// exactly at its stable fixed point (no multi-second drift on startup); the
// output undoes it with the inverse similarity transform cam = Rx(+90) q Rx(-90).
const Q_RX_P90 = new THREE.Quaternion(
  Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)
); // +90° about X
const Q_RX_M90 = new THREE.Quaternion(
  -Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)
); // -90° about X

/**
 * Lightweight 6-axis Madgwick AHRS orientation filter for Rokid Max 1st Gen IMU.
 */
class MadgwickFilter {
  q0 = 1;
  q1 = 0;
  q2 = 0;
  q3 = 0;
  private beta = 0.045;

  reset(): void {
    this.q0 = 1;
    this.q1 = 0;
    this.q2 = 0;
    this.q3 = 0;
  }

  update(
    gx: number,
    gy: number,
    gz: number,
    ax: number,
    ay: number,
    az: number,
    dt: number
  ): void {
    if (dt <= 0 || dt > 0.25) return;
    let q0 = this.q0;
    let q1 = this.q1;
    let q2 = this.q2;
    let q3 = this.q3;

    let qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    let qDot2 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
    let qDot3 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
    let qDot4 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

    const normSq = ax * ax + ay * ay + az * az;
    if (normSq > 1e-6) {
      const recipNorm = 1 / Math.sqrt(normSq);
      ax *= recipNorm;
      ay *= recipNorm;
      az *= recipNorm;

      const _2q0 = 2 * q0;
      const _2q1 = 2 * q1;
      const _2q2 = 2 * q2;
      const _2q3 = 2 * q3;
      const _4q0 = 4 * q0;
      const _4q1 = 4 * q1;
      const _4q2 = 4 * q2;
      const _8q1 = 8 * q1;
      const _8q2 = 8 * q2;
      const q0q0 = q0 * q0;
      const q1q1 = q1 * q1;
      const q2q2 = q2 * q2;
      const q3q3 = q3 * q3;

      let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
      let s1 =
        _4q1 * q3q3 -
        _2q3 * ax +
        4 * q0q0 * q1 -
        _2q0 * ay -
        _4q1 +
        _8q1 * q1q1 +
        _8q1 * q2q2 +
        _4q1 * az;
      let s2 =
        4 * q0q0 * q2 +
        _2q0 * ax +
        _4q2 * q3q3 -
        _2q3 * ay -
        _4q2 +
        _8q2 * q1q1 +
        _8q2 * q2q2 +
        _4q2 * az;
      let s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;

      const sNormSq = s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
      if (sNormSq > 1e-12) {
        const sRecip = 1 / Math.sqrt(sNormSq);
        s0 *= sRecip;
        s1 *= sRecip;
        s2 *= sRecip;
        s3 *= sRecip;

        qDot1 -= this.beta * s0;
        qDot2 -= this.beta * s1;
        qDot3 -= this.beta * s2;
        qDot4 -= this.beta * s3;
      }
    }

    q0 += qDot1 * dt;
    q1 += qDot2 * dt;
    q2 += qDot3 * dt;
    q3 += qDot4 * dt;

    const qRecip = 1 / Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    this.q0 = q0 * qRecip;
    this.q1 = q1 * qRecip;
    this.q2 = q2 * qRecip;
    this.q3 = q3 * qRecip;
  }
}

/**
 * VertoXR-compatible driver for Rokid Max (1st Gen) supporting both
 * desktop Chrome/Edge WebHID and standalone Android APK via Capacitor UsbManager.
 */
export class VertoRokidWebHIDDriver {
  private readonly transport: RokidTransportMode;
  private devices: HIDDevice[] = [];
  private nativeListeners: PluginListenerHandle[] = [];
  private status: WebHIDConnectionStatus = 'disconnected';
  private deviceName = 'Not Connected';
  private vendorIdHex = '0x04D2';
  private productIdHex = '----';
  private lastError?: string;

  private filter = new MadgwickFilter();
  private rawQuat = new THREE.Quaternion();
  private recenterInvQuat = new THREE.Quaternion();
  readonly orientation = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  private lastPacketTimeMs = 0;
  private packetCountWindow = 0;
  private rateWindowStartMs = 0;
  private lastSampleEmitMs = 0;
  private imuRateHz = 0;
  private rejectedPackets = 0;
  private temperatureC = 32.0;
  private gyroDeg: [number, number, number] = [0, 0, 0];
  private accelMps2: [number, number, number] = [0, 0, GRAVITY];

  private listeners = new Set<(state: RokidWebHIDState) => void>();
  private boundReportHandler = (e: Event) =>
    this.handleInputReport(e as HIDInputReportEvent);
  private boundDisconnectHandler = (e: Event) =>
    this.handleDisconnect(e as HIDConnectionEvent);

  constructor() {
    if (isRokidAndroidNativeAvailable()) {
      this.transport = 'android-usb';
      this.status = 'disconnected';
    } else if (typeof navigator !== 'undefined' && navigator.hid) {
      this.transport = 'webhid';
      navigator.hid.addEventListener('disconnect', this.boundDisconnectHandler);
    } else {
      this.transport = 'unsupported';
      this.status = 'unsupported';
      this.lastError =
        'WebHID requires Chrome/Edge on desktop, or the standalone Android APK.';
    }
  }

  getTransport(): RokidTransportMode {
    return this.transport;
  }

  isSupported(): boolean {
    return this.transport !== 'unsupported';
  }

  onStateChange(cb: (state: RokidWebHIDState) => void): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  private emitState(): void {
    const snap = this.getState();
    for (const cb of this.listeners) cb(snap);
  }

  async tryAutoReconnect(): Promise<boolean> {
    if (this.transport === 'android-usb') {
      try {
        const status = await RokidUsbNative.getStatus();
        if (status.connected) {
          await this.attachAndroidListeners();
          this.applyConnectedDeviceMetadata(
            status.vendorId,
            status.productId,
            status.deviceName
          );
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }

    if (this.transport !== 'webhid' || !navigator.hid) return false;
    try {
      const authorized = await navigator.hid.getDevices();
      const rokidDevices = authorized.filter(
        (d) => d.vendorId === ROKID_VENDOR_ID
      );
      if (rokidDevices.length === 0) return false;
      await this.attachDevices(rokidDevices);
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<RokidWebHIDState> {
    if (this.transport === 'android-usb') {
      return this.connectAndroidNative();
    }

    if (this.transport !== 'webhid' || !navigator.hid) {
      this.status = 'unsupported';
      this.lastError =
        'WebHID unavailable in this browser (use Chrome/Edge or Android APK).';
      this.emitState();
      return this.getState();
    }

    try {
      this.status = 'connecting';
      this.lastError = undefined;
      this.emitState();

      // VertoXR filter pattern: match all Rokid VID 0x04D2 HID interfaces
      const selected = await navigator.hid.requestDevice({
        filters: [{vendorId: ROKID_VENDOR_ID}],
      });

      if (!selected || selected.length === 0) {
        this.status = 'disconnected';
        this.emitState();
        return this.getState();
      }

      // Also gather any sibling Rokid HID interfaces already authorized on the same USB device
      const allAuthorized = await navigator.hid.getDevices();
      const rokidInterfaces = allAuthorized.filter(
        (d) => d.vendorId === ROKID_VENDOR_ID
      );
      const unique = Array.from(new Set([...selected, ...rokidInterfaces]));

      await this.attachDevices(unique);
    } catch (err) {
      this.status = 'error';
      this.lastError =
        err instanceof Error ? err.message : 'Failed to open Rokid Max WebHID';
      this.emitState();
    }

    return this.getState();
  }

  private async connectAndroidNative(): Promise<RokidWebHIDState> {
    try {
      this.status = 'connecting';
      this.lastError = undefined;
      this.emitState();

      await this.attachAndroidListeners();
      const info = await RokidUsbNative.connect();

      this.resetTrackingState();
      this.applyConnectedDeviceMetadata(
        info.vendorId,
        info.productId,
        info.deviceName
      );
    } catch (err) {
      await this.clearAndroidListeners();
      this.status = 'error';
      this.lastError =
        err instanceof Error
          ? err.message
          : 'Failed to open Rokid Max via Android UsbManager';
      this.emitState();
    }
    return this.getState();
  }

  private async attachAndroidListeners(): Promise<void> {
    if (this.nativeListeners.length > 0) return;

    const batchHandle = await RokidUsbNative.addListener(
      'imuBatch',
      (event: RokidUsbBatchEvent) => {
        if (!event?.packets) return;
        for (const pkt of event.packets) {
          const view = decodeBase64ToDataView(pkt.dataB64);
          this.processReportData(pkt.reportId, view, pkt.dtSec);
        }
      }
    );

    const detachHandle = await RokidUsbNative.addListener(
      'usbDetached',
      () => {
        void this.disconnect();
      }
    );

    this.nativeListeners.push(batchHandle, detachHandle);
  }

  private async clearAndroidListeners(): Promise<void> {
    const handles = this.nativeListeners;
    this.nativeListeners = [];
    for (const handle of handles) {
      try {
        await handle.remove();
      } catch {
        // Ignore teardown errors
      }
    }
  }

  private resetTrackingState(): void {
    this.filter.reset();
    this.recenterInvQuat.identity();
    this.orientation.identity();
    this.lastPacketTimeMs = 0;
    this.packetCountWindow = 0;
    this.rateWindowStartMs = performance.now();
  }

  private applyConnectedDeviceMetadata(
    vendorId: number,
    productId: number,
    fallbackName?: string
  ): void {
    this.vendorIdHex = `0x${vendorId.toString(16).toUpperCase().padStart(4, '0')}`;
    this.productIdHex = `0x${productId.toString(16).toUpperCase().padStart(4, '0')}`;
    this.deviceName =
      ROKID_MAX_PRODUCT_NAMES[productId] ||
      fallbackName ||
      'Rokid Max (1st Gen)';
    this.status = 'connected';
    this.lastError = undefined;
    this.emitState();
  }

  private async attachDevices(targets: HIDDevice[]): Promise<void> {
    await this.disconnect();
    this.resetTrackingState();

    for (const dev of targets) {
      try {
        if (!dev.opened) {
          await dev.open();
        }
        dev.addEventListener('inputreport', this.boundReportHandler);
        this.devices.push(dev);
        await this.sendVertoWakeHandshake(dev);
      } catch (err) {
        console.warn('Could not open Rokid HID interface:', dev.productName, err);
      }
    }

    if (this.devices.length === 0) {
      this.status = 'error';
      this.lastError = 'Unable to claim Rokid Max HID interface.';
      this.emitState();
      return;
    }

    const primary = this.devices[0];
    this.applyConnectedDeviceMetadata(
      primary.vendorId,
      primary.productId,
      primary.productName
    );
  }

  private async sendVertoWakeHandshake(device: HIDDevice): Promise<void> {
    // Some Rokid Max 1st-gen firmware revisions stream IMU automatically;
    // others wake when queried/enabled via feature/output reports.
    const hasFeature1 = device.collections.some((c) =>
      c.featureReports?.some((r) => r.reportId === 0x01)
    );
    if (hasFeature1) {
      try {
        await device.sendFeatureReport(0x01, new Uint8Array([0x01, 0x01]));
      } catch {
        // Passive stream firmware ignores feature reports safely
      }
    }
    const hasOutput1 = device.collections.some((c) =>
      c.outputReports?.some((r) => r.reportId === 0x01)
    );
    if (hasOutput1) {
      try {
        await device.sendReport(0x01, new Uint8Array([0x00, 0x01, 0x01]));
      } catch {
        // Ignore if interface is input-only
      }
    }
  }

  /**
   * Public hook to feed raw VertoXR/Rokid HID reports from external native or plugin bridges.
   */
  injectRawHidReport(reportId: number, data: DataView, dtOverrideSec?: number): void {
    this.processReportData(reportId, data, dtOverrideSec);
  }

  private handleInputReport(event: HIDInputReportEvent): void {
    this.processReportData(event.reportId, event.data);
  }

  private processReportData(
    reportId: number,
    data: DataView,
    dtOverrideSec?: number
  ): void {
    const now = performance.now();
    const dt =
      dtOverrideSec && dtOverrideSec > 0
        ? dtOverrideSec
        : this.lastPacketTimeMs > 0
          ? (now - this.lastPacketTimeMs) / 1000
          : 0.0025;
    this.lastPacketTimeMs = now;

    this.packetCountWindow++;
    if (now - this.rateWindowStartMs >= 500) {
      this.imuRateHz = Math.round(
        (this.packetCountWindow * 1000) / (now - this.rateWindowStartMs)
      );
      this.packetCountWindow = 0;
      this.rateWindowStartMs = now;
      this.emitState();
    }

    const len = data.byteLength;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let ax = 0;
    let ay = 0;
    let az = GRAVITY;
    let parsed = false;

    if (len >= 96) {
      // 128-byte Rokid Max USB HID IMU report (ar-drivers-rs / VertoXR 0x80 layout)
      // Temp at 0x2a (int16), Gyro at 0x3c (3x int32), Accel at 0x58 (3x int32)
      const tempRaw = data.getInt16(0x2a, true);
      const calcTemp = tempRaw / 326.8 + 25.0;
      if (calcTemp > 10 && calcTemp < 85) this.temperatureC = calcTemp;

      gx = (data.getInt32(0x3c, true) / 16.4) * DEG_TO_RAD;
      gy = (data.getInt32(0x40, true) / 16.4) * DEG_TO_RAD;
      gz = (data.getInt32(0x44, true) / 16.4) * DEG_TO_RAD;

      ax = (data.getInt32(0x58, true) / 16384.0) * GRAVITY;
      ay = (data.getInt32(0x5c, true) / 16384.0) * GRAVITY;
      az = (data.getInt32(0x60, true) / 16384.0) * GRAVITY;
      parsed = true;
    } else if (reportId === 0x11 && len >= 33) {
      // 64-byte Report ID 0x11 Rokid Max 1st Gen HID packet — layout verified
      // against live captures (2026-11-15):
      //   [0]      reportId 0x11
      //   [1..4]   i32 device timestamp (LE)
      //   [5..8]   i32 status/seq (constant 91)
      //   [9..20]  f32[3] accelerometer in m/s²   (|a| ≈ 9.79 at rest ✓)
      //   [21..32] f32[3] gyroscope in rad/s       (≈ 0.005 at rest ✓)
      //   [33..44] f32[3] magnetometer-ish (unused)
      // Values are already SI — no /16.4 or *DEG_TO_RAD scaling.
      ax = data.getFloat32(9, true);
      ay = data.getFloat32(13, true);
      az = data.getFloat32(17, true);
      gx = data.getFloat32(21, true);
      gy = data.getFloat32(25, true);
      gz = data.getFloat32(29, true);
      parsed = true;
    }

    if (!parsed) return;

    // Sanity gate: drop malformed packets instead of feeding garbage to AHRS.
    const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (
      !Number.isFinite(accelMag) ||
      !Number.isFinite(gyroMag) ||
      gyroMag > MAX_GYRO_RAD_S ||
      accelMag < MIN_ACCEL_MPS2 ||
      accelMag > MAX_ACCEL_MPS2
    ) {
      this.rejectedPackets++;
      if (this.rejectedPackets <= 5) {
        console.warn(
          `Rokid IMU: dropped malformed packet #${this.rejectedPackets} ` +
            `(gyroMag=${gyroMag.toFixed(2)} rad/s, accelMag=${accelMag.toFixed(2)} m/s²)`
        );
      }
      return;
    }

    this.gyroDeg[0] = Number((gx * RAD_TO_DEG).toFixed(2));
    this.gyroDeg[1] = Number((gy * RAD_TO_DEG).toFixed(2));
    this.gyroDeg[2] = Number((gz * RAD_TO_DEG).toFixed(2));
    this.accelMps2[0] = Number(ax.toFixed(2));
    this.accelMps2[1] = Number(ay.toFixed(2));
    this.accelMps2[2] = Number(az.toFixed(2));

    // Device -> filter frame: Rx(-90°) applied to both vectors
    // (x, y, z) -> (x, z, -y). See frame note above the constants.
    this.filter.update(gx, gz, -gy, ax, az, -ay, dt);
    this.rawQuat.set(
      this.filter.q1,
      this.filter.q2,
      this.filter.q3,
      this.filter.q0
    );
    // Filter -> three.js camera frame: similarity undo, Rx(+90) ⊗ q ⊗ Rx(-90).
    this.rawQuat.premultiply(Q_RX_P90).multiply(Q_RX_M90);
    this.orientation.multiplyQuaternions(this.recenterInvQuat, this.rawQuat);
    this.euler.setFromQuaternion(this.orientation, 'YXZ');

    if (now - this.lastSampleEmitMs >= 50) {
      this.lastSampleEmitMs = now;
      this.emitState();
    }
  }

  recenter(): void {
    this.recenterInvQuat.copy(this.rawQuat).invert();
    this.orientation.identity();
    this.euler.set(0, 0, 0, 'YXZ');
    this.emitState();
  }

  private handleDisconnect(event: HIDConnectionEvent): void {
    if (this.devices.includes(event.device)) {
      void this.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport === 'android-usb') {
      await this.clearAndroidListeners();
      try {
        await RokidUsbNative.disconnect();
      } catch {
        // Ignore native disconnect error if already detached
      }
    }

    for (const dev of this.devices) {
      dev.removeEventListener('inputreport', this.boundReportHandler);
      if (dev.opened) {
        try {
          await dev.close();
        } catch {
          // Ignore close errors on physical unplug
        }
      }
    }
    this.devices = [];
    if (this.status !== 'unsupported') {
      this.status = 'disconnected';
    }
    this.deviceName = 'Not Connected';
    this.productIdHex = '----';
    this.imuRateHz = 0;
    this.emitState();
  }

  getState(): RokidWebHIDState {
    return {
      status: this.status,
      deviceName: this.deviceName,
      vendorIdHex: this.vendorIdHex,
      productIdHex: this.productIdHex,
      imuRateHz: this.imuRateHz,
      droppedPackets: this.rejectedPackets,
      temperatureC: Number(this.temperatureC.toFixed(1)),
      yawDeg: Number((this.euler.y * RAD_TO_DEG).toFixed(1)),
      pitchDeg: Number((this.euler.x * RAD_TO_DEG).toFixed(1)),
      rollDeg: Number((this.euler.z * RAD_TO_DEG).toFixed(1)),
      gyroX: this.gyroDeg[0],
      gyroY: this.gyroDeg[1],
      gyroZ: this.gyroDeg[2],
      accelX: this.accelMps2[0],
      accelY: this.accelMps2[1],
      accelZ: this.accelMps2[2],
      lastError: this.lastError,
    };
  }

  dispose(): void {
    if (typeof navigator !== 'undefined' && navigator.hid) {
      navigator.hid.removeEventListener(
        'disconnect',
        this.boundDisconnectHandler
      );
    }
    void this.disconnect();
    this.listeners.clear();
  }
}
