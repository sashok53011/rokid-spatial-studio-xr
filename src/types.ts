import * as THREE from 'three';

export type MaterialPresetId =
  | 'titanium'
  | 'carbon'
  | 'cobalt'
  | 'sapphire'
  | 'ceramic'
  | 'gold';

export type PrototypeId = 'gimbal' | 'turbine' | 'canopy' | 'imported';

export type PowerProfileId = 'eco' | 'balanced' | 'performance';

export type RenderPipelineMode = 'edge' | 'cloud';

export type Camera360Id = 'ar' | 'cam1' | 'cam2' | 'cam3' | 'cam4';

export type ExportFormat = 'glb' | 'obj' | 'stl';

export interface MaterialPresetInfo {
  id: MaterialPresetId;
  name: string;
  swatchHex: string;
  description: string;
}

export interface Camera360Station {
  id: Exclude<Camera360Id, 'ar'>;
  index: number;
  label: string;
  subtitle: string;
  beaconPosition: THREE.Vector3;
  accentHex: number;
  skyTop: string;
  skyHorizon: string;
  floorGridColor: string;
  architectureTint: string;
}

export interface PowerProfileConfig {
  id: PowerProfileId;
  label: string;
  targetFps: number;
  maxPixelRatio: number;
  shadowsEnabled: boolean;
  depthColliderFps: number;
  estimatedWatts: number;
  batteryHours: number;
}

export interface SpatialPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  onEnable?: (ctx: PluginRuntimeContext) => void;
  onDisable?: (ctx: PluginRuntimeContext) => void;
  onUpdate?: (dt: number, ctx: PluginRuntimeContext) => void;
}

export interface PluginRuntimeContext {
  prototypeRoot: THREE.Object3D;
  scene: THREE.Scene;
  camera: THREE.Camera;
  stressFactor: number;
}

export interface CollaboratorState {
  peerId: string;
  name: string;
  device: string;
  colorHex: number;
  headPosition: [number, number, number];
  headQuaternion: [number, number, number, number];
  pointerTarget: [number, number, number];
  lastSeen: number;
}

export interface SyncSessionState {
  prototypeId: PrototypeId;
  materialId: MaterialPresetId;
  explodeAmount: number;
  camera360Id: Camera360Id;
  renderPipeline: RenderPipelineMode;
  powerProfile: PowerProfileId;
  prototypePosition: [number, number, number];
  prototypeRotationY: number;
  prototypeScale: number;
  timestamp: number;
  senderId: string;
}

export type WebHIDConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unsupported'
  | 'error';

export interface RokidWebHIDState {
  status: WebHIDConnectionStatus;
  deviceName: string;
  vendorIdHex: string;
  productIdHex: string;
  imuRateHz: number;
  /** Packets rejected by the IMU sanity gate (malformed/offset-mismatch). */
  droppedPackets?: number;
  temperatureC: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  lastError?: string;
}

export interface RokidTelemetrySnapshot {
  deviceModel: string;
  fovDegrees: number;
  displayHz: number;
  batteryPercent: number;
  thermalC: number;
  powerWatts: number;
  trackingState: string;
  latencyMs: number;
  fps: number;
  activeGesture: string;
  syncPeers: number;
  renderPipeline: RenderPipelineMode;
  webhid: RokidWebHIDState;
}
