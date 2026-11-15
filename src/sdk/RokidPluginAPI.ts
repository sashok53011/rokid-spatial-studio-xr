import * as THREE from 'three';
import * as xb from 'xrblocks';
import {
  PluginRuntimeContext,
  PowerProfileConfig,
  PowerProfileId,
  RenderPipelineMode,
  RokidTelemetrySnapshot,
  RokidWebHIDState,
  SpatialPlugin,
} from '../types.ts';
import {VertoRokidWebHIDDriver} from './VertoRokidWebHIDDriver.ts';

export const POWER_PROFILES: Record<PowerProfileId, PowerProfileConfig> = {
  eco: {
    id: 'eco',
    label: 'Eco 60Hz',
    targetFps: 60,
    maxPixelRatio: 1.0,
    shadowsEnabled: false,
    depthColliderFps: 4,
    estimatedWatts: 2.1,
    batteryHours: 4.8,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced AR',
    targetFps: 90,
    maxPixelRatio: 1.5,
    shadowsEnabled: true,
    depthColliderFps: 8,
    estimatedWatts: 3.4,
    batteryHours: 3.1,
  },
  performance: {
    id: 'performance',
    label: 'Fidelity 120Hz',
    targetFps: 120,
    maxPixelRatio: 2.0,
    shadowsEnabled: true,
    depthColliderFps: 15,
    estimatedWatts: 5.2,
    batteryHours: 1.9,
  },
};

export interface PublicRokidAPI {
  sdkVersion: string;
  registerPlugin: (plugin: SpatialPlugin) => void;
  togglePlugin: (id: string) => boolean;
  getPlugins: () => SpatialPlugin[];
  getTelemetry: () => RokidTelemetrySnapshot;
  connectRokidWebHID: () => Promise<RokidWebHIDState>;
  recenterRokidWebHID: () => void;
}

declare global {
  interface Window {
    RokidSpatialAPI?: PublicRokidAPI;
  }
}

export class RokidPluginAPI {
  readonly webhid: VertoRokidWebHIDDriver;
  private plugins = new Map<string, SpatialPlugin>();
  private powerProfile: PowerProfileId = 'balanced';
  private renderPipeline: RenderPipelineMode = 'edge';
  private activeGesture = 'Ready';
  private batteryPercent = 94.0;
  private thermalC = 34.2;
  private fpsSamples: number[] = [];
  private currentFps = 60;
  private syncPeers = 0;

  // Built-in plugin visual helpers
  private probeRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private stressTime = 0;
  private savedEmissives = new WeakMap<
    THREE.MeshStandardMaterial,
    {color: number; intensity: number}
  >();

  constructor(private isSoftwareGl: boolean) {
    this.webhid = new VertoRokidWebHIDDriver();
    this.probeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.255, 48),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      })
    );
    this.probeRing.rotation.x = -Math.PI / 2;
    this.probeRing.visible = false;
    this.probeRing.xb = {pointerEvents: 'none'};

    this.registerBuiltInPlugins();
    this.exposeGlobalAPI();
  }

  private registerBuiltInPlugins(): void {
    this.registerPlugin({
      id: 'stress-heatmap',
      name: 'FEA Stress Heatmap',
      version: '1.2.0',
      description: 'Thermal & mechanical load overlay on prototype parts',
      enabled: false,
      onDisable: (ctx) => {
        ctx.prototypeRoot.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            const mat = obj.material;
            if (mat instanceof THREE.MeshStandardMaterial) {
              const saved = this.savedEmissives.get(mat);
              if (saved) {
                mat.emissive.setHex(saved.color);
                mat.emissiveIntensity = saved.intensity;
              }
            }
          }
        });
      },
      onUpdate: (dt, ctx) => {
        this.stressTime += dt;
        const pulse = 0.5 + 0.5 * Math.sin(this.stressTime * 3.0);
        const load = Math.min(1, 0.35 + ctx.stressFactor * 0.65);
        ctx.prototypeRoot.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.userData.isPrimarySurface) {
            const mat = obj.material;
            if (mat instanceof THREE.MeshStandardMaterial) {
              if (!this.savedEmissives.has(mat)) {
                this.savedEmissives.set(mat, {
                  color: mat.emissive.getHex(),
                  intensity: mat.emissiveIntensity,
                });
              }
              mat.emissive.setRGB(
                0.85 * load,
                0.28 * (1 - load * 0.6),
                0.15 * (1 - load)
              );
              mat.emissiveIntensity = 0.25 + pulse * 0.55 * load;
            }
          }
        });
      },
    });

    this.registerPlugin({
      id: 'spatial-probe',
      name: 'Spatial Bounds Probe',
      version: '1.0.4',
      description: 'Calibrated 0.5m clearance halo & surface tracking ring',
      enabled: true,
      onEnable: (ctx) => {
        if (!this.probeRing.parent) ctx.scene.add(this.probeRing);
        this.probeRing.visible = true;
      },
      onDisable: () => {
        this.probeRing.visible = false;
      },
      onUpdate: (dt, ctx) => {
        if (!this.probeRing.parent) ctx.scene.add(this.probeRing);
        this.probeRing.visible = true;
        this.probeRing.position.set(
          ctx.prototypeRoot.position.x,
          ctx.prototypeRoot.position.y + 0.004,
          ctx.prototypeRoot.position.z
        );
        this.probeRing.rotation.z += dt * 0.45;
      },
    });
  }

  private exposeGlobalAPI(): void {
    window.RokidSpatialAPI = {
      sdkVersion: 'Rokid-VertoXR-WebHID/2.5.0',
      registerPlugin: (plugin) => this.registerPlugin(plugin),
      togglePlugin: (id) => this.togglePlugin(id),
      getPlugins: () => [...this.plugins.values()],
      getTelemetry: () => this.getTelemetry(),
      connectRokidWebHID: () => this.webhid.connect(),
      recenterRokidWebHID: () => this.webhid.recenter(),
    };
  }

  registerPlugin(plugin: SpatialPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  togglePlugin(id: string, ctx?: PluginRuntimeContext): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.enabled = !plugin.enabled;
    if (ctx) {
      if (plugin.enabled) plugin.onEnable?.(ctx);
      else plugin.onDisable?.(ctx);
    }
    return plugin.enabled;
  }

  getPlugin(id: string): SpatialPlugin | undefined {
    return this.plugins.get(id);
  }

  getPlugins(): SpatialPlugin[] {
    return [...this.plugins.values()];
  }

  applyPowerProfile(
    profileId: PowerProfileId,
    renderer?: THREE.WebGLRenderer,
    keyLight?: THREE.DirectionalLight
  ): PowerProfileConfig {
    this.powerProfile = profileId;
    const cfg = POWER_PROFILES[profileId];

    if (renderer) {
      const targetRatio = this.isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
      renderer.setPixelRatio(targetRatio);
      renderer.shadowMap.enabled = !this.isSoftwareGl && cfg.shadowsEnabled;
    }

    if (keyLight) {
      keyLight.castShadow = !this.isSoftwareGl && cfg.shadowsEnabled;
    }

    if (xb.core.options?.depth?.depthMesh) {
      xb.core.options.depth.depthMesh.colliderUpdateFps = cfg.depthColliderFps;
    }

    return cfg;
  }

  setRenderPipeline(
    mode: RenderPipelineMode,
    scene?: THREE.Scene,
    renderer?: THREE.WebGLRenderer
  ): void {
    this.renderPipeline = mode;
    if (scene) {
      scene.environmentIntensity = mode === 'cloud' ? 1.45 : 0.95;
    }
    if (renderer) {
      renderer.toneMappingExposure = mode === 'cloud' ? 1.18 : 1.02;
    }
  }

  getRenderPipeline(): RenderPipelineMode {
    return this.renderPipeline;
  }

  getPowerProfile(): PowerProfileId {
    return this.powerProfile;
  }

  setActiveGesture(name: string): void {
    this.activeGesture = name;
  }

  setSyncPeers(count: number): void {
    this.syncPeers = count;
  }

  update(dt: number, ctx: PluginRuntimeContext): void {
    if (dt > 0) {
      const instFps = Math.min(120, 1 / dt);
      this.fpsSamples.push(instFps);
      if (this.fpsSamples.length > 20) this.fpsSamples.shift();
      this.currentFps = Math.round(
        this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
      );
    }

    const cfg = POWER_PROFILES[this.powerProfile];
    const cloudDiscount = this.renderPipeline === 'cloud' ? 0.68 : 1.0;
    const effectiveWatts = cfg.estimatedWatts * cloudDiscount;
    // Slow realistic battery/thermal drift
    this.batteryPercent = Math.max(
      12,
      this.batteryPercent - (effectiveWatts * dt) / 180
    );
    const targetTemp = 31.5 + effectiveWatts * 1.45;
    this.thermalC = THREE.MathUtils.damp(this.thermalC, targetTemp, 0.8, dt);

    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) {
        plugin.onUpdate?.(dt, ctx);
      }
    }
  }

  getTelemetry(): RokidTelemetrySnapshot {
    const cfg = POWER_PROFILES[this.powerProfile];
    const cloudDiscount = this.renderPipeline === 'cloud' ? 0.68 : 1.0;
    const webhidState = this.webhid.getState();
    const trackingState =
      webhidState.status === 'connected'
        ? `VertoXR WebHID (${webhidState.imuRateHz}Hz)`
        : xb.core.renderer?.xr?.isPresenting
          ? '6DoF WebXR Active'
          : 'Simulated 6DoF';
    return {
      deviceModel:
        webhidState.status === 'connected'
          ? `${webhidState.deviceName} (${webhidState.productIdHex})`
          : 'Rokid Max · Dual 1080p Micro-OLED',
      fovDegrees: 50,
      displayHz: cfg.targetFps,
      batteryPercent: Number(this.batteryPercent.toFixed(1)),
      thermalC:
        webhidState.status === 'connected'
          ? webhidState.temperatureC
          : Number(this.thermalC.toFixed(1)),
      powerWatts: Number((cfg.estimatedWatts * cloudDiscount).toFixed(2)),
      trackingState,
      latencyMs:
        webhidState.status === 'connected'
          ? 2.3
          : this.renderPipeline === 'cloud'
            ? 11.4
            : 4.2,
      fps: this.currentFps,
      activeGesture: this.activeGesture,
      syncPeers: this.syncPeers,
      renderPipeline: this.renderPipeline,
      webhid: webhidState,
    };
  }

  dispose(): void {
    this.webhid.dispose();
    this.probeRing.removeFromParent();
    this.probeRing.geometry.dispose();
    this.probeRing.material.dispose();
    if (window.RokidSpatialAPI) {
      delete window.RokidSpatialAPI;
    }
  }
}
