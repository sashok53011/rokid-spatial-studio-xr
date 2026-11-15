import * as THREE from 'three';
import * as xb from 'xrblocks';
import {Panorama360Manager} from './environment/Panorama360Manager.ts';
import {UniversalModelIO} from './io/UniversalModelIO.ts';
import {
  detectSoftwareWebGL,
  MaterialLibrary,
} from './materials/MaterialLibrary.ts';
import {PhysicsSandbox} from './physics/PhysicsSandbox.ts';
import {
  BuiltPrototype,
  PrototypeFactory,
} from './prototypes/PrototypeFactory.ts';
import {RokidPluginAPI} from './sdk/RokidPluginAPI.ts';
import {CloudSyncManager} from './sync/CloudSyncManager.ts';
import {
  Camera360Id,
  ExportFormat,
  MaterialPresetId,
  PowerProfileId,
  PrototypeId,
  RenderPipelineMode,
  SyncSessionState,
} from './types.ts';
import {RokidConnectOverlay} from './ui/RokidConnectOverlay.ts';
import {DeckTabId, SpatialControlDeck} from './ui/SpatialControlDeck.ts';

export class SpatialStudioApp extends xb.Script {
  private readonly isSoftwareGl = detectSoftwareWebGL();
  private materials = new MaterialLibrary(this.isSoftwareGl);
  private factory = new PrototypeFactory(this.materials);
  private modelIO = new UniversalModelIO();
  private pluginAPI = new RokidPluginAPI(this.isSoftwareGl);

  private modelViewer!: xb.ModelViewer;
  private activePrototypeGroup: THREE.Group | null = null;
  private activeBuilt: BuiltPrototype | null = null;

  private panorama360!: Panorama360Manager;
  private physicsSandbox!: PhysicsSandbox;
  private cloudSync!: CloudSyncManager;
  private deck!: SpatialControlDeck;
  private connectOverlay!: RokidConnectOverlay;
  private unsubscribeWebHID?: () => void;

  private keyLight!: THREE.DirectionalLight;
  private contactShadow!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private contactShadowTexture!: THREE.CanvasTexture;

  private prototypeId: PrototypeId = 'gimbal';
  private materialId: MaterialPresetId = 'titanium';
  private targetExplode = 0;
  private currentExplode = 0;
  private camera360Id: Camera360Id = 'ar';
  private powerProfile: PowerProfileId = 'balanced';
  private renderPipeline: RenderPipelineMode = 'edge';
  private depthMeshVisible = false;
  private applyingRemoteState = false;

  private telemetryTimer = 0;
  private uiValidated = false;
  private tabOrder: DeckTabId[] = ['proto', 'cam360', 'sync', 'sdk'];
  private tabCursor = 0;

  private onGestureStartBound = (e: {detail: xb.GestureEvent['detail']}) =>
    this.handleGestureStart(e.detail);
  private onGestureEndBound = () => this.pluginAPI.setActiveGesture('Ready');

  private readonly _tmpVec = new THREE.Vector3();
  private readonly _tmpGazeTarget = new THREE.Vector3();

  constructor() {
    super();
    // Mount 2D VertoXR WebHID Connect button immediately on load
    this.connectOverlay = new RokidConnectOverlay({
      onConnectToggle: () => void this.toggleRokidWebHID(),
      onRecenter: () => this.recenterRokidWebHID(),
    });
    this.unsubscribeWebHID = this.pluginAPI.webhid.onStateChange((state) => {
      this.connectOverlay.updateState(state);
      if (this.deck) {
        this.deck.updateWebHIDState(state);
      }
    });
  }

  init(): void {
    this.setupLightingAndGround();

    this.modelViewer = new xb.ModelViewer({
      origin: 'bottom-center',
      manipulation: true,
      castShadow: !this.isSoftwareGl,
      receiveShadow: !this.isSoftwareGl,
    });
    this.modelViewer.position.set(0, 1.05, -1.15);
    this.add(this.modelViewer);

    this.panorama360 = new Panorama360Manager((camId) => {
      this.camera360Id = camId;
      this.deck.syncExternalSelections(this.getSyncSnapshot());
      this.deck.setStatus(`360° View: ${camId.toUpperCase()}`);
      this.emitSyncState();
    });
    this.add(this.panorama360);

    this.physicsSandbox = new PhysicsSandbox();
    this.add(this.physicsSandbox);

    this.cloudSync = new CloudSyncManager(
      (state) => this.applyRemoteState(state),
      (count) => this.pluginAPI.setSyncPeers(count)
    );
    this.add(this.cloudSync);

    this.deck = new SpatialControlDeck({
      onSelectPrototype: (id) => this.loadBuiltPrototype(id),
      onSelectMaterial: (id) => this.applyMaterial(id),
      onExplodeChange: (val) => {
        this.targetExplode = val;
        this.emitSyncState();
      },
      onTriggerPhysicsBurst: () => {
        this.physicsSandbox.triggerStressBurst(this.modelViewer.position);
        this.deck.setStatus('Physics: Dropped 10 dynamic probes');
      },
      onToggleZeroGravity: () => {
        const nextZero = this.physicsSandbox.getGravity() !== 0;
        this.physicsSandbox.setGravity(nextZero ? 0 : -9.81);
        this.deck.setStatus(
          nextZero ? 'Physics: Zero-G enabled' : 'Physics: Earth Gravity (9.81 m/s²)'
        );
        return nextZero;
      },
      onClearPhysics: () => {
        this.physicsSandbox.clearAll();
        this.deck.setStatus('Physics probes cleared');
      },
      onSelectCamera360: (id) => this.setCamera360(id),
      onToggleDepthMesh: () => this.toggleDepthMesh(),
      onToggleCloudSync: () => {
        const next = !this.cloudSync.isSyncEnabled();
        this.cloudSync.setSyncEnabled(next);
        this.deck.setStatus(
          next ? 'Cloud Sync: Active' : 'Cloud Sync: Paused'
        );
        return next;
      },
      onToggleSimulatedPeer: () => {
        const active = this.cloudSync.toggleSimulatedCollaborator();
        this.deck.setStatus(
          active ? 'Collaborator joined workspace' : 'Collaborator disconnected'
        );
        return active;
      },
      onExportModel: (format) => void this.exportCurrentModel(format),
      onImportModel: () => void this.importCustomModel(),
      onSelectPowerProfile: (id) => this.applyPowerProfile(id),
      onToggleRenderPipeline: () => this.toggleRenderPipeline(),
      onTogglePlugin: (pluginId) => {
        const enabled = this.pluginAPI.togglePlugin(pluginId, {
          prototypeRoot: this.modelViewer,
          scene: xb.core.scene,
          camera: xb.core.camera,
          stressFactor: this.physicsSandbox.getActiveProbeCount() / 10,
        });
        this.deck.setStatus(`Plugin ${pluginId}: ${enabled ? 'ON' : 'OFF'}`);
        return enabled;
      },
      onResetWorkspace: () => this.resetWorkspace(),
      onConnectWebHID: () => void this.toggleRokidWebHID(),
      onRecenterWebHID: () => this.recenterRokidWebHID(),
    });

    this.add(this.deck.leftCard, this.deck.rightCard, this.deck.bottomOverlay);
    this.deck.bindDeviceCamera();
    this.deck.updateWebHIDState(this.pluginAPI.webhid.getState());

    // Install studio PMREM reflection environment once WebGLRenderer is live
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    if (renderer && xb.core.scene) {
      this.materials.installStudioEnvironment(renderer, xb.core.scene);
      if (!this.isSoftwareGl) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }

    this.applyPowerProfile('balanced');
    this.loadBuiltPrototype('gimbal');

    // Attempt silent auto-reconnect if Rokid Max (Gen 1) was previously paired
    void this.pluginAPI.webhid.tryAutoReconnect();

    // Bind gesture recognition events
    const gestures = xb.core.gestureRecognition;
    if (gestures) {
      gestures.addEventListener('gesturestart', this.onGestureStartBound);
      gestures.addEventListener('gestureend', this.onGestureEndBound);
    }
  }

  private async toggleRokidWebHID(): Promise<void> {
    const current = this.pluginAPI.webhid.getState();
    if (current.status === 'connected') {
      await this.pluginAPI.webhid.disconnect();
      this.deck?.setStatus('Rokid Max WebHID disconnected');
      return;
    }
    const next = await this.pluginAPI.webhid.connect();
    if (next.status === 'connected') {
      this.deck?.setStatus(`Connected: ${next.deviceName} (${next.productIdHex})`);
    } else if (next.lastError) {
      this.deck?.setStatus(`WebHID: ${next.lastError}`);
    }
  }

  private recenterRokidWebHID(): void {
    this.pluginAPI.webhid.recenter();
    this.deck?.setStatus('Rokid Max 3DoF orientation recentered');
  }

  private setupLightingAndGround(): void {
    this.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.5));

    this.keyLight = new THREE.DirectionalLight(0xfff7ed, 2.4);
    this.keyLight.position.set(2.5, 4.5, 2.5);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 12;
    const d = 2.2;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rimLight.position.set(-2.5, 2.0, -3.5);
    this.add(rimLight);

    // Soft radial contact shadow under prototype
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    this.contactShadowTexture = new THREE.CanvasTexture(shadowCanvas);
    this.contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshBasicMaterial({
        map: this.contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.75,
      })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, 1.045, -1.15);
    this.contactShadow.xb = {pointerEvents: 'none'};
    this.add(this.contactShadow);
  }

  private loadBuiltPrototype(id: Exclude<PrototypeId, 'imported'>): void {
    this.disposeActivePrototype();
    this.prototypeId = id;
    const built = this.factory.build(id, this.materialId);
    this.activeBuilt = built;
    this.activePrototypeGroup = built.group;
    this.modelViewer.setContent(built.group);
    this.deck.setStatus(`Loaded: ${built.name}`);
    this.emitSyncState();
  }

  private applyMaterial(id: MaterialPresetId): void {
    this.materialId = id;
    if (this.activePrototypeGroup) {
      this.factory.applyMaterialPreset(this.activePrototypeGroup, id);
    }
    this.deck.setStatus(`Material: ${id.toUpperCase()}`);
    this.emitSyncState();
  }

  private setCamera360(id: Camera360Id): void {
    this.camera360Id = id;
    this.panorama360.setActiveCamera(id);
    this.deck.setStatus(
      id === 'ar'
        ? 'Optical AR Passthrough Active'
        : `360° Spatial Walkthrough: ${id.toUpperCase()}`
    );
    this.emitSyncState();
  }

  private toggleDepthMesh(): boolean {
    this.depthMeshVisible = !this.depthMeshVisible;
    const depthMesh = xb.core.depth?.depthMesh;
    if (depthMesh && 'material' in depthMesh) {
      const mat = depthMesh.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uOpacity) {
        mat.uniforms.uOpacity.value = this.depthMeshVisible ? 0.42 : 0.0;
      }
    }
    this.deck.setStatus(
      this.depthMeshVisible
        ? 'Environment Depth Mesh: Visible'
        : 'Environment Depth Mesh: Hidden'
    );
    return this.depthMeshVisible;
  }

  private applyPowerProfile(id: PowerProfileId): void {
    this.powerProfile = id;
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const cfg = this.pluginAPI.applyPowerProfile(id, renderer, this.keyLight);
    this.deck.setStatus(
      `Power: ${cfg.label} (~${cfg.batteryHours}h est.)`
    );
    this.emitSyncState();
  }

  private toggleRenderPipeline(): RenderPipelineMode {
    this.renderPipeline = this.renderPipeline === 'edge' ? 'cloud' : 'edge';
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    this.pluginAPI.setRenderPipeline(
      this.renderPipeline,
      xb.core.scene,
      renderer
    );
    this.deck.setStatus(
      this.renderPipeline === 'cloud'
        ? 'Pipeline: Cloud Hybrid Offload (4K IBL)'
        : 'Pipeline: Local Rokid Edge XR'
    );
    this.emitSyncState();
    return this.renderPipeline;
  }

  private async exportCurrentModel(format: ExportFormat): Promise<void> {
    if (!this.activePrototypeGroup) return;
    try {
      this.deck.setStatus(`Exporting .${format.toUpperCase()}…`);
      const summary = await this.modelIO.exportObject(
        this.activePrototypeGroup,
        format,
        `rokid-${this.prototypeId}`
      );
      this.deck.setStatus(`Exported ${summary}`);
    } catch (err) {
      this.deck.setStatus(
        `Export failed: ${err instanceof Error ? err.message : 'error'}`
      );
    }
  }

  private async importCustomModel(): Promise<void> {
    try {
      const defaultMat = this.materials.getPresetMaterial(this.materialId);
      const imported = await this.modelIO.promptFileImport(defaultMat);
      if (!imported) return;
      this.disposeActivePrototype();
      this.prototypeId = 'imported';
      this.activeBuilt = null;
      this.activePrototypeGroup = imported.group;
      this.modelViewer.setContent(imported.group);
      this.deck.setStatus(`Imported: ${imported.name}`);
      this.emitSyncState();
    } catch (err) {
      this.deck.setStatus(
        `Import error: ${err instanceof Error ? err.message : 'invalid file'}`
      );
    }
  }

  private resetWorkspace(): void {
    this.modelViewer.position.set(0, 1.05, -1.15);
    this.modelViewer.rotation.set(0, 0, 0);
    this.modelViewer.scale.setScalar(1);
    this.targetExplode = 0;
    this.currentExplode = 0;
    this.setCamera360('ar');
    this.applyMaterial('titanium');
    this.loadBuiltPrototype('gimbal');
    this.physicsSandbox.clearAll();
    this.deck.leftCard.position.set(-0.74, 1.42, -1.12);
    this.deck.leftCard.rotation.set(0, 0.24, 0);
    this.deck.rightCard.position.set(0.74, 1.42, -1.12);
    this.deck.rightCard.rotation.set(0, -0.24, 0);
    this.deck.syncExternalSelections(this.getSyncSnapshot());
    this.deck.setStatus('Workspace Reset');
  }

  private handleGestureStart(detail?: xb.GestureEvent['detail']): void {
    if (!detail) return;
    this.pluginAPI.setActiveGesture(`${detail.name} (${detail.hand})`);

    if (detail.name === 'point') {
      this._tmpVec.copy(this.modelViewer.position);
      this._tmpVec.y += 0.55;
      this.physicsSandbox.spawnProbe(
        this._tmpVec,
        new THREE.Vector3(0, -0.4, 0)
      );
    } else if (detail.name === 'spread') {
      this.tabCursor = (this.tabCursor + 1) % this.tabOrder.length;
      this.deck.selectTab(this.tabOrder[this.tabCursor]);
    }
  }

  onSelectStart(event: xb.SelectEvent): void {
    // Allow clicking any of the 4 360-degree camera beacons in 3D space
    if (this.panorama360.handleHitObject(event.target)) {
      event.stopPropagation();
      return;
    }

    // If user clicks empty physical depth surface, anchor prototype there
    if (
      xb.core.depth?.depthMesh &&
      event.surface === xb.core.depth.depthMesh &&
      event.intersection
    ) {
      this.modelViewer.position.copy(event.intersection.point);
      this.deck.setStatus('Anchored prototype to spatial surface');
      this.emitSyncState();
    }
  }

  private getSyncSnapshot(): Omit<
    SyncSessionState,
    'senderId' | 'timestamp'
  > {
    return {
      prototypeId: this.prototypeId,
      materialId: this.materialId,
      explodeAmount: this.targetExplode,
      camera360Id: this.camera360Id,
      renderPipeline: this.renderPipeline,
      powerProfile: this.powerProfile,
      prototypePosition: [
        this.modelViewer.position.x,
        this.modelViewer.position.y,
        this.modelViewer.position.z,
      ],
      prototypeRotationY: this.modelViewer.rotation.y,
      prototypeScale: this.modelViewer.scale.x,
    };
  }

  private emitSyncState(): void {
    if (this.applyingRemoteState || !this.cloudSync) return;
    this.cloudSync.broadcastState(this.getSyncSnapshot());
  }

  private applyRemoteState(state: SyncSessionState): void {
    this.applyingRemoteState = true;
    try {
      if (state.prototypeId !== this.prototypeId && state.prototypeId !== 'imported') {
        this.loadBuiltPrototype(state.prototypeId);
      }
      if (state.materialId !== this.materialId) {
        this.applyMaterial(state.materialId);
      }
      this.targetExplode = state.explodeAmount;
      if (state.camera360Id !== this.camera360Id) {
        this.setCamera360(state.camera360Id);
      }
      if (state.powerProfile !== this.powerProfile) {
        this.applyPowerProfile(state.powerProfile);
      }
      if (state.renderPipeline !== this.renderPipeline) {
        this.renderPipeline = state.renderPipeline;
        this.pluginAPI.setRenderPipeline(
          state.renderPipeline,
          xb.core.scene,
          xb.core.renderer as THREE.WebGLRenderer | undefined
        );
      }
      this.modelViewer.position.set(...state.prototypePosition);
      this.modelViewer.rotation.y = state.prototypeRotationY;
      this.modelViewer.scale.setScalar(state.prototypeScale);
      this.deck.syncExternalSelections(this.getSyncSnapshot());
    } finally {
      this.applyingRemoteState = false;
    }
  }

  update(): void {
    const dt = Math.min(xb.getDeltaTime(), 0.05);

    // 1. Smoothly damp exploded view separation
    if (Math.abs(this.currentExplode - this.targetExplode) > 0.0005) {
      this.currentExplode = THREE.MathUtils.damp(
        this.currentExplode,
        this.targetExplode,
        7.5,
        dt
      );
      if (this.activePrototypeGroup) {
        this.activePrototypeGroup.traverse((obj) => {
          const base = obj.userData.basePosition as THREE.Vector3 | undefined;
          const vec = obj.userData.explodeVector as THREE.Vector3 | undefined;
          if (base && vec) {
            obj.position.copy(base).addScaledVector(vec, this.currentExplode);
          }
        });
      }
    }

    // 2. Subtle continuous mechanical animation on moving sub-parts
    if (this.activeBuilt) {
      for (const part of this.activeBuilt.animatedParts) {
        if (this.activeBuilt.id === 'turbine') {
          part.rotation.z -= dt * 3.8;
        } else {
          part.rotation.y += dt * 0.55;
        }
      }
    }

    // 3. Keep contact shadow & physics pedestal aligned with prototype
    this.contactShadow.position.set(
      this.modelViewer.position.x,
      this.modelViewer.position.y - 0.005,
      this.modelViewer.position.z
    );
    this.contactShadow.scale.setScalar(this.modelViewer.scale.x);
    this.physicsSandbox.updatePedestalCollider(
      this.modelViewer.position,
      this.modelViewer.scale.x
    );

    // 4. Apply VertoXR WebHID Rokid Max 1st Gen 3DoF orientation when connected in non-WebXR DP-Alt mode
    const webhidState = this.pluginAPI.webhid.getState();
    if (
      webhidState.status === 'connected' &&
      xb.core.camera &&
      !xb.core.renderer?.xr?.isPresenting
    ) {
      xb.core.camera.quaternion.slerp(
        this.pluginAPI.webhid.orientation,
        1 - Math.exp(-30 * dt)
      );
    }

    // 5. Broadcast local head pose & update multi-user avatars
    if (xb.core.camera) {
      this._tmpGazeTarget.copy(this.modelViewer.position);
      this._tmpGazeTarget.y += 0.16;
      this.cloudSync.broadcastPose(
        xb.core.camera.position,
        xb.core.camera.quaternion,
        this._tmpGazeTarget
      );
    }
    this.cloudSync.setFocusPoint(this.modelViewer.position);

    // 6. Update Rokid SDK plugins & telemetry readout (throttled to 4Hz for crisp legibility)
    if (xb.core.scene && xb.core.camera) {
      this.pluginAPI.update(dt, {
        prototypeRoot: this.modelViewer,
        scene: xb.core.scene,
        camera: xb.core.camera,
        stressFactor: this.physicsSandbox.getActiveProbeCount() / 10,
      });
    }

    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.25) {
      this.telemetryTimer = 0;
      const snapshot = this.pluginAPI.getTelemetry();
      this.deck.updateTelemetry(snapshot);
      this.connectOverlay.updateState(snapshot.webhid);

      // Run spatial UI validation once mounted layout has completed
      if (!this.uiValidated && xb.ui?.validate) {
        const report = xb.ui.validate();
        if (report.ready) {
          this.uiValidated = true;
          if (!report.ok) {
            console.warn('Spatial UI validation issues:', report.issues);
          }
        }
      }
    }
  }

  private disposeActivePrototype(): void {
    if (!this.activePrototypeGroup) return;
    const primaryPresetMats = new Set<THREE.Material>();
    for (const preset of ['titanium', 'carbon', 'cobalt', 'sapphire', 'ceramic', 'gold'] as MaterialPresetId[]) {
      primaryPresetMats.add(this.materials.getPresetMaterial(preset));
    }
    this.activePrototypeGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => {
            if (!primaryPresetMats.has(m)) m.dispose();
          });
        } else if (obj.material && !primaryPresetMats.has(obj.material)) {
          // Keep shared accent materials managed by MaterialLibrary
        }
      }
    });
    this.activePrototypeGroup = null;
    this.activeBuilt = null;
  }

  dispose(): void {
    const gestures = xb.core.gestureRecognition;
    if (gestures) {
      gestures.removeEventListener('gesturestart', this.onGestureStartBound);
      gestures.removeEventListener('gestureend', this.onGestureEndBound);
    }
    this.unsubscribeWebHID?.();
    this.connectOverlay.dispose();
    this.disposeActivePrototype();
    this.contactShadow.geometry.dispose();
    this.contactShadow.material.dispose();
    this.contactShadowTexture.dispose();
    this.deck.dispose();
    this.pluginAPI.dispose();
    this.materials.dispose();
  }
}
