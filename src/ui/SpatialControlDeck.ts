import * as THREE from 'three';
import * as xb from 'xrblocks';
import {CAMERA_360_STATIONS} from '../environment/Panorama360Manager.ts';
import {MATERIAL_PRESETS} from '../materials/MaterialLibrary.ts';
import {
  Camera360Id,
  ExportFormat,
  MaterialPresetId,
  PowerProfileId,
  PrototypeId,
  RenderPipelineMode,
  RokidTelemetrySnapshot,
  RokidWebHIDState,
} from '../types.ts';

export type DeckTabId = 'proto' | 'cam360' | 'sync' | 'sdk';

export interface SpatialControlCallbacks {
  onSelectPrototype: (id: Exclude<PrototypeId, 'imported'>) => void;
  onSelectMaterial: (id: MaterialPresetId) => void;
  onExplodeChange: (value: number) => void;
  onTriggerPhysicsBurst: () => void;
  onToggleZeroGravity: () => boolean;
  onClearPhysics: () => void;
  onSelectCamera360: (id: Camera360Id) => void;
  onToggleDepthMesh: () => boolean;
  onToggleCloudSync: () => boolean;
  onToggleSimulatedPeer: () => boolean;
  onExportModel: (format: ExportFormat) => void;
  onImportModel: () => void;
  onSelectPowerProfile: (id: PowerProfileId) => void;
  onToggleRenderPipeline: () => RenderPipelineMode;
  onTogglePlugin: (pluginId: string) => boolean;
  onResetWorkspace: () => void;
  onConnectWebHID: () => void;
  onRecenterWebHID: () => void;
}

const EMPTY_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export class SpatialControlDeck {
  readonly leftCard: xb.UICard;
  readonly rightCard: xb.UICard;
  readonly bottomOverlay: xb.UIOverlay;

  private tabButtons = new Map<DeckTabId, xb.UIButton>();
  private tabPanels = new Map<DeckTabId, xb.UIPanel>();
  private statusText: xb.UIText;
  private explodeValueText: xb.UIText;
  private explodeSlider: xb.UISlider;

  private protoButtons = new Map<string, xb.UIButton>();
  private materialButtons = new Map<MaterialPresetId, xb.UIButton>();
  private camButtons = new Map<Camera360Id, xb.UIButton>();
  private powerButtons = new Map<PowerProfileId, xb.UIButton>();

  private zeroGButton!: xb.UIButton;
  private depthButton!: xb.UIButton;
  private syncButton!: xb.UIButton;
  private peerButton!: xb.UIButton;
  private pipelineButton!: xb.UIButton;
  private stressPluginButton!: xb.UIButton;
  private probePluginButton!: xb.UIButton;
  private sdkWebhidButton!: xb.UIButton;
  private cardWebhidButton!: xb.UIButton;
  private cardRecenterButton!: xb.UIButton;

  // Right telemetry & live camera card elements
  private cameraImage!: xb.UIImage;
  private cameraStatusText!: xb.UIText;
  private webhidImuText!: xb.UIText;
  private telemetryLine1!: xb.UIText;
  private telemetryLine2!: xb.UIText;
  private telemetryLine3!: xb.UIText;
  private gestureText!: xb.UIText;
  private overlayHintText!: xb.UIText;

  private deviceCamera: xb.Core['deviceCamera'];
  private onCameraStateChange?: (event: unknown) => void;

  constructor(private callbacks: SpatialControlCallbacks) {
    this.statusText = new xb.UIText({
      text: 'Rokid Max WebXR Ready',
      style: {
        width: '100%',
        fontSize: 15,
        opacity: 0.85,
        textAlign: 'center',
        color: '#7dd3fc',
      },
    });
    this.explodeValueText = new xb.UIText({
      text: '0%',
      style: {fontSize: 16, fontWeight: 'bold'},
    });
    this.explodeSlider = new xb.UISlider({
      ariaLabel: 'Exploded assembly view',
      min: 0,
      max: 100,
      step: 2,
      value: 0,
      style: {width: '100%', height: 38},
      onInput: (val) => {
        this.explodeValueText.text = `${Math.round(val)}%`;
        this.callbacks.onExplodeChange(val / 100);
      },
    });

    this.leftCard = this.buildLeftControlCard();
    this.rightCard = this.buildRightTelemetryCard();
    this.bottomOverlay = this.buildBottomOverlay();

    this.selectTab('proto');
    this.highlightButtonMap(this.protoButtons, 'gimbal');
    this.highlightButtonMap(this.materialButtons, 'titanium');
    this.highlightButtonMap(this.camButtons, 'ar');
    this.highlightButtonMap(this.powerButtons, 'balanced');
  }

  private buildLeftControlCard(): xb.UICard {
    const tabRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [
        this.makeTabButton('proto', 'Proto', 'deployed_code'),
        this.makeTabButton('cam360', '360°', 'vrpano'),
        this.makeTabButton('sync', 'Sync/IO', 'cloud_sync'),
        this.makeTabButton('sdk', 'SDK', 'memory'),
      ],
    });

    const protoPanel = this.buildProtoPanel();
    const camPanel = this.buildCam360Panel();
    const syncPanel = this.buildSyncIOPanel();
    const sdkPanel = this.buildSDKPanel();

    this.tabPanels.set('proto', protoPanel);
    this.tabPanels.set('cam360', camPanel);
    this.tabPanels.set('sync', syncPanel);
    this.tabPanels.set('sdk', sdkPanel);

    const card = new xb.UICard({
      size: {width: 0.66, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [
            new xb.UIText({
              text: 'ROKID SPATIAL STUDIO',
              style: {fontSize: 21, fontWeight: 'bold'},
            }),
            new xb.UIButton({
              icon: 'restart_alt',
              ariaLabel: 'Reset workspace',
              onClick: () => this.callbacks.onResetWorkspace(),
              style: {width: 42, height: 38, padding: 0},
            }),
          ],
        }),
        tabRow,
        protoPanel,
        camPanel,
        syncPanel,
        sdkPanel,
        this.statusText,
      ],
    });

    card.name = 'Rokid Control Deck';
    card.position.set(-0.74, 1.42, -1.12);
    card.rotation.y = 0.24;
    return card;
  }

  private makeTabButton(id: DeckTabId, label: string, icon: string): xb.UIButton {
    const btn = new xb.UIButton({
      label,
      icon,
      style: {flexGrow: 1, height: 42, fontSize: 14},
      onClick: () => this.selectTab(id),
    });
    this.tabButtons.set(id, btn);
    return btn;
  }

  private buildProtoPanel(): xb.UIPanel {
    const gimbalBtn = new xb.UIButton({
      label: 'Gimbal',
      style: {flexGrow: 1, height: 40, fontSize: 14},
      onClick: () => {
        this.callbacks.onSelectPrototype('gimbal');
        this.highlightButtonMap(this.protoButtons, 'gimbal');
      },
    });
    const turbineBtn = new xb.UIButton({
      label: 'Turbine',
      style: {flexGrow: 1, height: 40, fontSize: 14},
      onClick: () => {
        this.callbacks.onSelectPrototype('turbine');
        this.highlightButtonMap(this.protoButtons, 'turbine');
      },
    });
    const canopyBtn = new xb.UIButton({
      label: 'Canopy',
      style: {flexGrow: 1, height: 40, fontSize: 14},
      onClick: () => {
        this.callbacks.onSelectPrototype('canopy');
        this.highlightButtonMap(this.protoButtons, 'canopy');
      },
    });
    this.protoButtons.set('gimbal', gimbalBtn);
    this.protoButtons.set('turbine', turbineBtn);
    this.protoButtons.set('canopy', canopyBtn);

    const matRow1: xb.UIButton[] = [];
    const matRow2: xb.UIButton[] = [];
    MATERIAL_PRESETS.forEach((preset, idx) => {
      const btn = new xb.UIButton({
        label: preset.name,
        style: {flexGrow: 1, height: 38, fontSize: 13},
        onClick: () => {
          this.callbacks.onSelectMaterial(preset.id);
          this.highlightButtonMap(this.materialButtons, preset.id);
        },
      });
      this.materialButtons.set(preset.id, btn);
      if (idx < 3) matRow1.push(btn);
      else matRow2.push(btn);
    });

    this.zeroGButton = new xb.UIButton({
      label: 'Zero-G',
      icon: 'blur_on',
      style: {flexGrow: 1, height: 40, fontSize: 13},
      onClick: () => {
        const isZero = this.callbacks.onToggleZeroGravity();
        this.zeroGButton.label = isZero ? 'Earth G' : 'Zero-G';
      },
    });

    return new xb.UIPanel({
      style: {width: '100%', flexDirection: 'column', gap: 10},
      children: [
        new xb.UIText({
          text: 'Prototype Assembly',
          style: {fontSize: 15, opacity: 0.78},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [gimbalBtn, turbineBtn, canopyBtn],
        }),
        new xb.UIText({
          text: 'Photorealistic PBR Material',
          style: {fontSize: 15, opacity: 0.78},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: matRow1,
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: matRow2,
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [
            new xb.UIText({text: 'Exploded View', style: {fontSize: 15}}),
            this.explodeValueText,
          ],
        }),
        this.explodeSlider,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Physics Drop',
              icon: 'science',
              style: {flexGrow: 1, height: 40, fontSize: 13},
              onClick: () => this.callbacks.onTriggerPhysicsBurst(),
            }),
            this.zeroGButton,
            new xb.UIButton({
              icon: 'delete_sweep',
              ariaLabel: 'Clear physics probes',
              style: {width: 44, height: 40, padding: 0},
              onClick: () => this.callbacks.onClearPhysics(),
            }),
          ],
        }),
      ],
    });
  }

  private buildCam360Panel(): xb.UIPanel {
    const arBtn = new xb.UIButton({
      label: 'AR Optical Passthrough',
      icon: 'visibility',
      style: {width: '100%', height: 42, fontSize: 14},
      onClick: () => {
        this.callbacks.onSelectCamera360('ar');
        this.highlightButtonMap(this.camButtons, 'ar');
      },
    });
    this.camButtons.set('ar', arBtn);

    const rowA: xb.UIButton[] = [];
    const rowB: xb.UIButton[] = [];
    CAMERA_360_STATIONS.forEach((st, idx) => {
      const btn = new xb.UIButton({
        label: st.label,
        icon: '360',
        style: {flexGrow: 1, height: 42, fontSize: 13},
        onClick: () => {
          this.callbacks.onSelectCamera360(st.id);
          this.highlightButtonMap(this.camButtons, st.id);
        },
      });
      this.camButtons.set(st.id, btn);
      if (idx < 2) rowA.push(btn);
      else rowB.push(btn);
    });

    this.depthButton = new xb.UIButton({
      label: 'Env Depth Mesh: OFF',
      icon: 'grid_on',
      style: {width: '100%', height: 40, fontSize: 14},
      onClick: () => {
        const active = this.callbacks.onToggleDepthMesh();
        this.depthButton.label = active
          ? 'Env Depth Mesh: ON'
          : 'Env Depth Mesh: OFF';
      },
    });

    return new xb.UIPanel({
      style: {width: '100%', flexDirection: 'column', gap: 10},
      children: [
        new xb.UIText({
          text: '4x 360° Spatial Walkthrough Cameras',
          style: {fontSize: 15, opacity: 0.78},
        }),
        arBtn,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: rowA,
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: rowB,
        }),
        new xb.UIText({
          text: 'Real-Time Environment Mapping',
          style: {fontSize: 15, opacity: 0.78, marginTop: 4},
        }),
        this.depthButton,
      ],
    });
  }

  private buildSyncIOPanel(): xb.UIPanel {
    this.syncButton = new xb.UIButton({
      label: 'Cloud Sync: ON',
      icon: 'sync',
      style: {flexGrow: 1, height: 42, fontSize: 14},
      onClick: () => {
        const active = this.callbacks.onToggleCloudSync();
        this.syncButton.label = active ? 'Cloud Sync: ON' : 'Cloud Sync: OFF';
      },
    });
    this.peerButton = new xb.UIButton({
      label: 'Add AR Peer',
      icon: 'group_add',
      style: {flexGrow: 1, height: 42, fontSize: 14},
      onClick: () => {
        const active = this.callbacks.onToggleSimulatedPeer();
        this.peerButton.label = active ? 'Remove Peer' : 'Add AR Peer';
      },
    });

    return new xb.UIPanel({
      style: {width: '100%', flexDirection: 'column', gap: 10},
      children: [
        new xb.UIText({
          text: 'Multi-User Cross-Platform Sync',
          style: {fontSize: 15, opacity: 0.78},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [this.syncButton, this.peerButton],
        }),
        new xb.UIText({
          text: 'Universal 3D Export / Import',
          style: {fontSize: 15, opacity: 0.78, marginTop: 4},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: '.GLB',
              icon: 'download',
              style: {flexGrow: 1, height: 40, fontSize: 13},
              onClick: () => this.callbacks.onExportModel('glb'),
            }),
            new xb.UIButton({
              label: '.OBJ',
              icon: 'download',
              style: {flexGrow: 1, height: 40, fontSize: 13},
              onClick: () => this.callbacks.onExportModel('obj'),
            }),
            new xb.UIButton({
              label: '.STL',
              icon: 'download',
              style: {flexGrow: 1, height: 40, fontSize: 13},
              onClick: () => this.callbacks.onExportModel('stl'),
            }),
          ],
        }),
        new xb.UIButton({
          label: 'Import 3D Model (.GLB / .OBJ / .STL)',
          icon: 'upload_file',
          style: {width: '100%', height: 42, fontSize: 14},
          onClick: () => this.callbacks.onImportModel(),
        }),
      ],
    });
  }

  private buildSDKPanel(): xb.UIPanel {
    const ecoBtn = new xb.UIButton({
      label: 'Eco 60Hz',
      style: {flexGrow: 1, height: 40, fontSize: 13},
      onClick: () => {
        this.callbacks.onSelectPowerProfile('eco');
        this.highlightButtonMap(this.powerButtons, 'eco');
      },
    });
    const balBtn = new xb.UIButton({
      label: 'Balanced',
      style: {flexGrow: 1, height: 40, fontSize: 13},
      onClick: () => {
        this.callbacks.onSelectPowerProfile('balanced');
        this.highlightButtonMap(this.powerButtons, 'balanced');
      },
    });
    const perfBtn = new xb.UIButton({
      label: '120Hz Max',
      style: {flexGrow: 1, height: 40, fontSize: 13},
      onClick: () => {
        this.callbacks.onSelectPowerProfile('performance');
        this.highlightButtonMap(this.powerButtons, 'performance');
      },
    });
    this.powerButtons.set('eco', ecoBtn);
    this.powerButtons.set('balanced', balBtn);
    this.powerButtons.set('performance', perfBtn);

    this.pipelineButton = new xb.UIButton({
      label: 'Render: Local Edge AR',
      icon: 'cloud_queue',
      style: {width: '100%', height: 42, fontSize: 14},
      onClick: () => {
        const mode = this.callbacks.onToggleRenderPipeline();
        this.pipelineButton.label =
          mode === 'cloud'
            ? 'Render: Cloud Hybrid Pipeline'
            : 'Render: Local Edge AR';
      },
    });

    this.stressPluginButton = new xb.UIButton({
      label: 'Plugin: FEA Stress [OFF]',
      icon: 'thermostat',
      style: {width: '100%', height: 40, fontSize: 13},
      onClick: () => {
        const enabled = this.callbacks.onTogglePlugin('stress-heatmap');
        this.stressPluginButton.label = enabled
          ? 'Plugin: FEA Stress [ON]'
          : 'Plugin: FEA Stress [OFF]';
      },
    });

    this.probePluginButton = new xb.UIButton({
      label: 'Plugin: Bounds Probe [ON]',
      icon: 'radar',
      style: {width: '100%', height: 40, fontSize: 13},
      onClick: () => {
        const enabled = this.callbacks.onTogglePlugin('spatial-probe');
        this.probePluginButton.label = enabled
          ? 'Plugin: Bounds Probe [ON]'
          : 'Plugin: Bounds Probe [OFF]';
      },
    });

    this.sdkWebhidButton = new xb.UIButton({
      label: 'Connect Rokid Max (VertoXR WebHID)',
      icon: 'usb',
      style: {width: '100%', height: 42, fontSize: 13},
      onClick: () => this.callbacks.onConnectWebHID(),
    });

    return new xb.UIPanel({
      style: {width: '100%', flexDirection: 'column', gap: 8},
      children: [
        this.sdkWebhidButton,
        new xb.UIText({
          text: 'Battery & Thermal Power Profile',
          style: {fontSize: 15, opacity: 0.78},
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 6},
          children: [ecoBtn, balBtn, perfBtn],
        }),
        this.pipelineButton,
        new xb.UIText({
          text: 'Third-Party Rokid SDK Plugins',
          style: {fontSize: 15, opacity: 0.78, marginTop: 2},
        }),
        this.stressPluginButton,
        this.probePluginButton,
      ],
    });
  }

  private buildRightTelemetryCard(): xb.UICard {
    this.cameraImage = new xb.UIImage({
      src: EMPTY_IMAGE,
      ariaLabel: 'Live AR camera stream',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 150,
        objectFit: 'cover',
        borderRadius: 14,
        backgroundColor: '#0b1120',
      },
    });
    this.cameraStatusText = new xb.UIText({
      text: 'Camera Stream: Initializing…',
      style: {fontSize: 13, opacity: 0.8},
    });
    this.telemetryLine1 = new xb.UIText({
      text: 'Display: 1080p Micro-OLED · 90Hz',
      style: {fontSize: 14},
    });
    this.telemetryLine2 = new xb.UIText({
      text: 'Power: 94% · 34.2°C · 3.4W',
      style: {fontSize: 14},
    });
    this.telemetryLine3 = new xb.UIText({
      text: 'Pipeline: Edge · 4.2ms · 0 Peers',
      style: {fontSize: 14},
    });
    this.gestureText = new xb.UIText({
      text: 'Gesture: Ready (Point / Spread)',
      style: {fontSize: 14, color: '#34d399', fontWeight: 'bold'},
    });
    this.webhidImuText = new xb.UIText({
      text: 'VertoXR WebHID: Not Connected (0x04D2)',
      style: {fontSize: 13, color: '#7dd3fc'},
    });
    this.cardWebhidButton = new xb.UIButton({
      label: 'Connect Rokid Max',
      icon: 'usb',
      style: {flexGrow: 1, height: 38, fontSize: 13},
      onClick: () => this.callbacks.onConnectWebHID(),
    });
    this.cardRecenterButton = new xb.UIButton({
      label: 'Recenter 3DoF',
      icon: 'center_focus_strong',
      disabled: true,
      style: {flexGrow: 1, height: 38, fontSize: 13},
      onClick: () => this.callbacks.onRecenterWebHID(),
    });

    const card = new xb.UICard({
      size: {width: 0.56, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {flexDirection: 'column', gap: 10, padding: 16},
      children: [
        new xb.UIText({
          text: 'ROKID MAX SENSOR & STREAM',
          style: {fontSize: 18, fontWeight: 'bold'},
        }),
        this.cameraImage,
        this.cameraStatusText,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [this.cardWebhidButton, this.cardRecenterButton],
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'column',
            gap: 6,
            padding: 10,
            borderRadius: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
          },
          children: [
            this.webhidImuText,
            this.telemetryLine1,
            this.telemetryLine2,
            this.telemetryLine3,
            this.gestureText,
          ],
        }),
      ],
    });
    card.name = 'Rokid Sensor Telemetry';
    card.position.set(0.74, 1.42, -1.12);
    card.rotation.y = -0.24;
    return card;
  }

  private buildBottomOverlay(): xb.UIOverlay {
    this.overlayHintText = new xb.UIText({
      text: 'Drag prototype to rotate/move • Click 360° beacons • Drag UI cards by edge',
      pointerEvents: 'none',
      style: {fontSize: 16, textAlign: 'center', opacity: 0.9},
    });

    const overlay = new xb.UIOverlay({
      style: {
        width: 760,
        position: 'absolute',
        left: '50%',
        bottom: 20,
        transform: {translateX: '-50%'},
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 10,
      },
      children: [new xb.UIExitButton(), this.overlayHintText],
    });
    overlay.name = 'Studio HUD';
    return overlay;
  }

  bindDeviceCamera(): void {
    const cam = xb.core.deviceCamera;
    if (!cam) return;
    this.deviceCamera = cam;
    const syncFeed = (evt: {state?: string; device?: {label?: string}}) => {
      if (evt.state === 'streaming') {
        this.cameraImage.src = cam.texture;
        this.cameraStatusText.text = `Stream: ${evt.device?.label || 'Live AR Camera'}`;
      } else if (evt.state === 'no_devices_found') {
        this.cameraStatusText.text = 'Stream: Passthrough Simulated';
      } else if (evt.state === 'error') {
        this.cameraStatusText.text = 'Stream: Camera Permission Declined';
      } else {
        this.cameraStatusText.text = 'Stream: Optical Sensor Standby';
      }
    };
    this.onCameraStateChange = (event) =>
      syncFeed(event as {state?: string; device?: {label?: string}});
    cam.addEventListener('statechange', this.onCameraStateChange);
    syncFeed({state: cam.state, device: cam.getCurrentDevice()});
  }

  selectTab(id: DeckTabId): void {
    for (const [tabId, panel] of this.tabPanels.entries()) {
      panel.visible = tabId === id;
    }
    this.highlightButtonMap(this.tabButtons, id);
  }

  private highlightButtonMap<K>(
    map: Map<K, xb.UIButton>,
    activeKey: K
  ): void {
    for (const [key, btn] of map.entries()) {
      btn.style.backgroundColor =
        key === activeKey
          ? 'rgba(56, 189, 248, 0.38)'
          : 'rgba(255, 255, 255, 0.08)';
    }
  }

  syncExternalSelections(opts: {
    prototypeId: PrototypeId;
    materialId: MaterialPresetId;
    explodeAmount: number;
    camera360Id: Camera360Id;
    powerProfile: PowerProfileId;
    renderPipeline: RenderPipelineMode;
  }): void {
    if (opts.prototypeId !== 'imported') {
      this.highlightButtonMap(this.protoButtons, opts.prototypeId);
    }
    this.highlightButtonMap(this.materialButtons, opts.materialId);
    this.highlightButtonMap(this.camButtons, opts.camera360Id);
    this.highlightButtonMap(this.powerButtons, opts.powerProfile);
    const pct = Math.round(opts.explodeAmount * 100);
    this.explodeSlider.value = pct;
    this.explodeValueText.text = `${pct}%`;
    this.pipelineButton.label =
      opts.renderPipeline === 'cloud'
        ? 'Render: Cloud Hybrid Pipeline'
        : 'Render: Local Edge AR';
  }

  setStatus(text: string): void {
    this.statusText.text = text;
  }

  updateWebHIDState(state: RokidWebHIDState): void {
    if (state.status === 'connected') {
      this.webhidImuText.text = `IMU ${state.imuRateHz}Hz · Y:${state.yawDeg}° P:${state.pitchDeg}° R:${state.rollDeg}°`;
      this.webhidImuText.style.color = '#34d399';
      this.cardWebhidButton.label = 'Disconnect Rokid';
      this.sdkWebhidButton.label = `Connected: ${state.deviceName} (${state.productIdHex})`;
      this.cardRecenterButton.disabled = false;
    } else if (state.status === 'unsupported') {
      this.webhidImuText.text = 'WebHID unsupported (use Chrome / Edge)';
      this.webhidImuText.style.color = '#fbbf24';
      this.cardWebhidButton.disabled = true;
      this.sdkWebhidButton.disabled = true;
      this.cardRecenterButton.disabled = true;
    } else if (state.status === 'error') {
      this.webhidImuText.text = `WebHID Error: ${state.lastError || 'Retry'}`;
      this.webhidImuText.style.color = '#fb7185';
      this.cardWebhidButton.label = 'Retry Rokid Max';
      this.sdkWebhidButton.label = 'Retry Rokid Max (VertoXR WebHID)';
      this.cardRecenterButton.disabled = true;
    } else {
      this.webhidImuText.text = 'VertoXR WebHID: Ready (Rokid Gen 1 0x04D2)';
      this.webhidImuText.style.color = '#7dd3fc';
      this.cardWebhidButton.label = 'Connect Rokid Max';
      this.sdkWebhidButton.label = 'Connect Rokid Max (VertoXR WebHID)';
      this.cardRecenterButton.disabled = true;
    }
  }

  updateTelemetry(t: RokidTelemetrySnapshot): void {
    this.updateWebHIDState(t.webhid);
    this.telemetryLine1.text = `Display: ${t.displayHz}Hz · ${t.fovDegrees}° FoV · ${t.fps} FPS`;
    this.telemetryLine2.text = `Power: ${t.batteryPercent}% · ${t.thermalC}°C · ${t.powerWatts}W`;
    this.telemetryLine3.text = `Render: ${t.renderPipeline.toUpperCase()} (${t.latencyMs}ms) · ${t.syncPeers} Peers`;
    this.gestureText.text = `Gesture: ${t.activeGesture} · ${t.trackingState}`;
  }

  dispose(): void {
    if (this.deviceCamera && this.onCameraStateChange) {
      this.deviceCamera.removeEventListener(
        'statechange',
        this.onCameraStateChange
      );
    }
  }
}
