import {isRokidAndroidNativeAvailable} from '../sdk/RokidAndroidUsbBridge.ts';
import {RokidWebHIDState} from '../types.ts';
import {RokidImuChart} from './RokidImuChart.ts';

export interface RokidConnectOverlayCallbacks {
  onConnectToggle: () => void;
  onRecenter: () => void;
}

export class RokidConnectOverlay {
  private container: HTMLDivElement;
  private statusLabel: HTMLSpanElement;
  private imuLabel: HTMLSpanElement;
  private imuChart: RokidImuChart;
  private connectButton: HTMLButtonElement;
  private recenterButton: HTMLButtonElement;
  private readonly isAndroidUsb = isRokidAndroidNativeAvailable();

  constructor(private callbacks: RokidConnectOverlayCallbacks) {
    this.container = document.createElement('div');
    this.container.id = 'rokid-webhid-dock';

    const title = document.createElement('div');
    title.className = 'rokid-dock-title';
    title.textContent = this.isAndroidUsb
      ? 'ANDROID USB-HOST · ROKID MAX (GEN 1)'
      : 'VERTOXR WEB-HID · ROKID MAX (GEN 1)';

    this.statusLabel = document.createElement('span');
    this.statusLabel.className = 'rokid-dock-status';
    this.statusLabel.textContent = 'Not Connected (VID 0x04D2)';

    this.imuLabel = document.createElement('span');
    this.imuLabel.className = 'rokid-dock-imu';
    this.imuLabel.textContent = 'Connect USB-C DP glasses for 400Hz 3DoF IMU';

    this.imuChart = new RokidImuChart();

    const btnRow = document.createElement('div');
    btnRow.className = 'rokid-dock-actions';

    this.connectButton = document.createElement('button');
    this.connectButton.type = 'button';
    this.connectButton.id = 'rokid-webhid-connect-btn';
    this.connectButton.className = 'rokid-dock-btn rokid-dock-btn-primary';
    this.connectButton.textContent = 'Connect Rokid Max';
    this.connectButton.addEventListener('click', () =>
      this.callbacks.onConnectToggle()
    );

    this.recenterButton = document.createElement('button');
    this.recenterButton.type = 'button';
    this.recenterButton.className = 'rokid-dock-btn rokid-dock-btn-secondary';
    this.recenterButton.textContent = 'Recenter 3DoF';
    this.recenterButton.style.display = 'none';
    this.recenterButton.addEventListener('click', () =>
      this.callbacks.onRecenter()
    );

    btnRow.append(this.connectButton, this.recenterButton);
    this.container.append(
      title,
      this.statusLabel,
      this.imuLabel,
      this.imuChart.element,
      btnRow
    );
    document.body.appendChild(this.container);
  }

  updateState(state: RokidWebHIDState): void {
    this.imuChart.pushSample(state);

    if (state.status === 'connected') {
      this.statusLabel.textContent = `Connected: ${state.deviceName} (${state.vendorIdHex}:${state.productIdHex})`;
      this.statusLabel.style.color = '#34d399';
      this.imuLabel.textContent = `IMU ${state.imuRateHz}Hz · Y:${state.yawDeg}° P:${state.pitchDeg}° R:${state.rollDeg}° · ${state.temperatureC}°C`;
      this.connectButton.textContent = 'Disconnect Rokid';
      this.connectButton.disabled = false;
      this.recenterButton.style.display = 'inline-flex';
    } else if (state.status === 'connecting') {
      this.statusLabel.textContent = this.isAndroidUsb
        ? 'Requesting Android USB Permission…'
        : 'Opening VertoXR WebHID Picker…';
      this.statusLabel.style.color = '#38bdf8';
      this.connectButton.textContent = 'Connecting…';
      this.connectButton.disabled = true;
      this.recenterButton.style.display = 'none';
    } else if (state.status === 'unsupported') {
      this.statusLabel.textContent = 'WebHID Unavailable in This Browser';
      this.statusLabel.style.color = '#fbbf24';
      this.imuLabel.textContent =
        state.lastError || 'Use Chrome / Edge or Android APK';
      this.connectButton.textContent = 'WebHID Unsupported';
      this.connectButton.disabled = true;
      this.recenterButton.style.display = 'none';
    } else if (state.status === 'error') {
      this.statusLabel.textContent = 'Connection Error';
      this.statusLabel.style.color = '#fb7185';
      this.imuLabel.textContent =
        state.lastError || 'Ensure Rokid Max USB-C is plugged in';
      this.connectButton.textContent = 'Retry Rokid Max';
      this.connectButton.disabled = false;
      this.recenterButton.style.display = 'none';
    } else {
      this.statusLabel.textContent = 'Ready · Rokid Max 1st Gen (0x04D2)';
      this.statusLabel.style.color = '#94a3b8';
      this.imuLabel.textContent = this.isAndroidUsb
        ? 'Tap Connect to pair via Android UsbManager'
        : 'Click Connect to pair via VertoXR WebHID';
      this.connectButton.textContent = 'Connect Rokid Max';
      this.connectButton.disabled = false;
      this.recenterButton.style.display = 'none';
    }
  }

  dispose(): void {
    this.imuChart.dispose();
    this.container.remove();
  }
}
