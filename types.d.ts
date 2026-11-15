declare module 'troika-three-text' {
  export * from 'troika-types/packages/troika-three-text/dist/src/index';
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
  type?: number;
  inputReports?: {reportId: number}[];
  outputReports?: {reportId: number}[];
  featureReports?: {reportId: number}[];
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: {filters: HIDDeviceFilter[]}): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid?: HID;
}
