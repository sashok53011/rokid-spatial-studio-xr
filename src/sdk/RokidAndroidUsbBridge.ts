import {Capacitor, PluginListenerHandle, registerPlugin} from '@capacitor/core';

export interface RokidUsbPacketPayload {
  reportId: number;
  dataB64: string;
  dtSec: number;
}

export interface RokidUsbBatchEvent {
  packets: RokidUsbPacketPayload[];
}

export interface RokidUsbDeviceInfo {
  connected: boolean;
  deviceName: string;
  vendorId: number;
  productId: number;
  interfaceCount?: number;
}

export interface RokidUsbNativePlugin {
  connect(): Promise<RokidUsbDeviceInfo>;
  disconnect(): Promise<void>;
  getStatus(): Promise<RokidUsbDeviceInfo>;
  addListener(
    eventName: 'imuBatch',
    listenerFunc: (event: RokidUsbBatchEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'usbDetached',
    listenerFunc: (event: {reason?: string}) => void
  ): Promise<PluginListenerHandle>;
}

export const RokidUsbNative =
  registerPlugin<RokidUsbNativePlugin>('RokidUsb');

export function isRokidAndroidNativeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('RokidUsb')
  );
}

export function decodeBase64ToDataView(base64: string): DataView {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
