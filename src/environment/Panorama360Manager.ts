import * as THREE from 'three';
import * as xb from 'xrblocks';
import {Camera360Id, Camera360Station} from '../types.ts';

export const CAMERA_360_STATIONS: Camera360Station[] = [
  {
    id: 'cam1',
    index: 1,
    label: 'Cam 01 · Atrium',
    subtitle: 'Glass Curtain Lobby · 360°',
    beaconPosition: new THREE.Vector3(-1.35, 1.05, -2.05),
    accentHex: 0x38bdf8,
    skyTop: '#0b192c',
    skyHorizon: '#1e4e79',
    floorGridColor: 'rgba(56, 189, 248, 0.35)',
    architectureTint: 'rgba(125, 211, 252, 0.22)',
  },
  {
    id: 'cam2',
    index: 2,
    label: 'Cam 02 · Mezzanine',
    subtitle: 'Structural Truss Span · 360°',
    beaconPosition: new THREE.Vector3(-0.48, 1.05, -2.35),
    accentHex: 0xa78bfa,
    skyTop: '#16112b',
    skyHorizon: '#4338ca',
    floorGridColor: 'rgba(167, 139, 250, 0.35)',
    architectureTint: 'rgba(196, 181, 253, 0.22)',
  },
  {
    id: 'cam3',
    index: 3,
    label: 'Cam 03 · Cleanroom',
    subtitle: 'ISO-5 Optics Bay · 360°',
    beaconPosition: new THREE.Vector3(0.48, 1.05, -2.35),
    accentHex: 0x34d399,
    skyTop: '#06201c',
    skyHorizon: '#0f766e',
    floorGridColor: 'rgba(52, 211, 153, 0.35)',
    architectureTint: 'rgba(110, 231, 183, 0.22)',
  },
  {
    id: 'cam4',
    index: 4,
    label: 'Cam 04 · Helipad',
    subtitle: 'Rooftop Skyline Deck · 360°',
    beaconPosition: new THREE.Vector3(1.35, 1.05, -2.05),
    accentHex: 0xfbbf24,
    skyTop: '#1c1208',
    skyHorizon: '#b45309',
    floorGridColor: 'rgba(251, 191, 36, 0.35)',
    architectureTint: 'rgba(253, 224, 71, 0.22)',
  },
];

interface BeaconNode {
  station: Camera360Station;
  root: THREE.Group;
  ringMesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  hitProxy: THREE.Mesh;
}

export class Panorama360Manager extends xb.Script {
  private domeMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private textures = new Map<string, THREE.CanvasTexture>();
  private beacons: BeaconNode[] = [];
  private activeCameraId: Camera360Id = 'ar';
  private onCameraSelected?: (id: Camera360Id) => void;
  private pulseTime = 0;

  constructor(onCameraSelected?: (id: Camera360Id) => void) {
    super();
    this.onCameraSelected = onCameraSelected;

    const domeGeo = new THREE.SphereGeometry(24, 48, 32);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.domeMesh = new THREE.Mesh(domeGeo, domeMat);
    this.domeMesh.name = '360 Spatial Panorama Dome';
    this.domeMesh.visible = false;
    this.domeMesh.xb = {pointerEvents: 'none'};
    this.add(this.domeMesh);

    for (const station of CAMERA_360_STATIONS) {
      this.textures.set(station.id, this.createEquirectangularTexture(station));
      this.createBeacon(station);
    }
  }

  private createEquirectangularTexture(
    station: Camera360Station
  ): THREE.CanvasTexture {
    const w = 1024;
    const h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    // Sky to ground gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0.0, station.skyTop);
    skyGrad.addColorStop(0.46, station.skyHorizon);
    skyGrad.addColorStop(0.5, '#0f172a');
    skyGrad.addColorStop(1.0, '#04070d');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Architectural elevation ribs & glazing mullions around 360 deg
    ctx.strokeStyle = station.architectureTint;
    ctx.lineWidth = 2;
    const cols = 16;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * w;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.14);
      ctx.lineTo(x, h * 0.86);
      ctx.stroke();

      // Structural bay windows
      if (i < cols) {
        ctx.fillStyle = station.architectureTint;
        ctx.fillRect(x + 8, h * 0.24, w / cols - 16, h * 0.18);
      }
    }

    // Horizontal datum lines & floor ring grid
    for (let j = 1; j < 10; j++) {
      const y = (j / 10) * h;
      ctx.strokeStyle =
        j >= 5 ? station.floorGridColor : station.architectureTint;
      ctx.lineWidth = j === 5 ? 3 : 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Cardinal spatial camera markers (N / E / S / W)
    const headings = ['NORTH 000°', 'EAST 090°', 'SOUTH 180°', 'WEST 270°'];
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    headings.forEach((label, idx) => {
      const x = ((idx + 0.5) / 4) * w;
      ctx.fillText(label, x, h * 0.48);
    });

    // Station badge in panorama
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(
      `${station.label.toUpperCase()} — ${station.subtitle.toUpperCase()}`,
      w / 2,
      h * 0.18
    );

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  private createBeacon(station: Camera360Station): void {
    const root = new THREE.Group();
    root.name = `Beacon_${station.id}`;
    root.position.copy(station.beaconPosition);

    const coreMat = new THREE.MeshStandardMaterial({
      color: station.accentHex,
      emissive: station.accentHex,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.7,
    });
    const coreMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.048, 1),
      coreMat
    );
    coreMesh.position.y = 0.08;
    root.add(coreMesh);

    const ringMat = new THREE.MeshBasicMaterial({
      color: station.accentHex,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.068, 0.084, 32),
      ringMat
    );
    ringMesh.rotation.x = -Math.PI / 2;
    root.add(ringMesh);

    // Stem down to floor reference
    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.5,
      metalness: 0.8,
    });
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.012, 0.08, 12),
      stemMat
    );
    stem.position.y = 0.04;
    root.add(stem);

    // Invisible hit proxy sphere for clean XR ray selection
    const hitProxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshBasicMaterial({visible: false})
    );
    hitProxy.position.y = 0.07;
    hitProxy.userData.camera360Id = station.id;
    root.add(hitProxy);

    this.add(root);
    this.beacons.push({station, root, ringMesh, coreMesh, hitProxy});
  }

  setActiveCamera(id: Camera360Id): void {
    this.activeCameraId = id;
    if (id === 'ar') {
      this.domeMesh.visible = false;
      this.domeMesh.material.opacity = 0;
      if (xb.core.transition?.currentMode === 'VR') {
        xb.core.transition.toAR();
      }
    } else {
      const tex = this.textures.get(id);
      if (tex) {
        this.domeMesh.material.map = tex;
        this.domeMesh.material.needsUpdate = true;
      }
      this.domeMesh.visible = true;
      this.domeMesh.material.opacity = 1;
      if (xb.core.transition && xb.core.transition.currentMode === 'AR') {
        xb.core.transition.toVR({color: 0x090d16, targetAlpha: 0.15});
      }
    }

    for (const b of this.beacons) {
      const active = b.station.id === id;
      (b.coreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
        active ? 1.8 : 0.55;
      b.ringMesh.scale.setScalar(active ? 1.35 : 1.0);
    }
  }

  getActiveCameraId(): Camera360Id {
    return this.activeCameraId;
  }

  handleHitObject(target?: THREE.Object3D): boolean {
    if (!target) return false;
    let curr: THREE.Object3D | null = target;
    while (curr) {
      const camId = curr.userData?.camera360Id as Camera360Id | undefined;
      if (camId) {
        const nextId: Camera360Id = this.activeCameraId === camId ? 'ar' : camId;
        this.setActiveCamera(nextId);
        this.onCameraSelected?.(nextId);
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  update(): void {
    const dt = xb.getDeltaTime();
    this.pulseTime += dt;
    if (xb.core.camera && this.domeMesh.visible) {
      this.domeMesh.position.copy(xb.core.camera.position);
    }
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      b.coreMesh.rotation.y += dt * 0.9;
      b.coreMesh.position.y = 0.08 + Math.sin(this.pulseTime * 2 + i) * 0.012;
    }
  }

  dispose(): void {
    this.domeMesh.geometry.dispose();
    this.domeMesh.material.dispose();
    for (const tex of this.textures.values()) tex.dispose();
    this.textures.clear();
    for (const b of this.beacons) {
      b.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    this.beacons = [];
  }
}
