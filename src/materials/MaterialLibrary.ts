import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MaterialPresetId, MaterialPresetInfo} from '../types.ts';

export const MATERIAL_PRESETS: MaterialPresetInfo[] = [
  {
    id: 'titanium',
    name: 'Brushed Ti',
    swatchHex: '#a7b4c4',
    description: 'Anisotropic Grade-5 aerospace titanium',
  },
  {
    id: 'carbon',
    name: 'Carbon Weave',
    swatchHex: '#2c3138',
    description: 'Clearcoated 3K twill forged carbon fiber',
  },
  {
    id: 'cobalt',
    name: 'Cobalt Alloy',
    swatchHex: '#2563eb',
    description: 'Iridescent anodized cobalt-chromium',
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    swatchHex: '#67e8f9',
    description: 'Optical-grade refractive sapphire glass',
  },
  {
    id: 'ceramic',
    name: 'Ceramic',
    swatchHex: '#e7e5e4',
    description: 'Matte thermal-barrier zirconia composite',
  },
  {
    id: 'gold',
    name: '24K Gold',
    swatchHex: '#eab308',
    description: 'Vapor-deposited reflective conductive gold',
  },
];

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class MaterialLibrary {
  readonly isSoftwareGl: boolean;
  private textures: THREE.Texture[] = [];
  private materials = new Map<MaterialPresetId, THREE.MeshPhysicalMaterial>();
  private accentMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private envTexture: THREE.Texture | null = null;

  constructor(isSoftwareGl: boolean) {
    this.isSoftwareGl = isSoftwareGl;
    this.buildProceduralPresets();
  }

  installStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.envTexture) return;
    const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    for (const tex of this.textures) {
      tex.anisotropy = maxAniso;
      tex.needsUpdate = true;
    }

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const renderTarget = pmrem.fromScene(roomEnv, 0.04);
    this.envTexture = renderTarget.texture;
    scene.environment = this.envTexture;
    roomEnv.dispose();
    pmrem.dispose();
  }

  private createBrushedBumpTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) {
      const lum = 108 + Math.floor(Math.random() * 44);
      ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
      ctx.fillRect(0, y, 256, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    this.textures.push(tex);
    return tex;
  }

  private createCarbonWeaveTextures(): {
    map: THREE.CanvasTexture;
    bumpMap: THREE.CanvasTexture;
  } {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 128;
    colorCanvas.height = 128;
    const cCtx = colorCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 128;
    bumpCanvas.height = 128;
    const bCtx = bumpCanvas.getContext('2d')!;

    const cell = 16;
    for (let y = 0; y < 128; y += cell) {
      for (let x = 0; x < 128; x += cell) {
        const diag = ((x / cell) + (y / cell)) % 2 === 0;
        cCtx.fillStyle = diag ? '#262b33' : '#14171c';
        cCtx.fillRect(x, y, cell, cell);
        cCtx.fillStyle = diag ? '#353c47' : '#1c2026';
        cCtx.fillRect(x + 2, y + 2, cell - 4, cell - 4);

        bCtx.fillStyle = diag ? '#b8b8b8' : '#585858';
        bCtx.fillRect(x, y, cell, cell);
      }
    }

    const map = new THREE.CanvasTexture(colorCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(6, 6);

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(6, 6);

    this.textures.push(map, bumpMap);
    return {map, bumpMap};
  }

  private createCeramicSpeckleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ece9e4';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const shade = 210 + Math.floor(Math.random() * 35);
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
      ctx.fillRect(x, y, 2, 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    this.textures.push(tex);
    return tex;
  }

  private buildProceduralPresets(): void {
    const brushedBump = this.createBrushedBumpTexture();
    const carbon = this.createCarbonWeaveTextures();
    const ceramicMap = this.createCeramicSpeckleTexture();

    this.materials.set(
      'titanium',
      new THREE.MeshPhysicalMaterial({
        color: 0xaab7c7,
        metalness: 0.94,
        roughness: 0.22,
        anisotropy: 0.85,
        anisotropyRotation: 0.35,
        bumpMap: brushedBump,
        bumpScale: 0.0025,
        clearcoat: 0.15,
        clearcoatRoughness: 0.25,
        envMapIntensity: 1.25,
      })
    );

    this.materials.set(
      'carbon',
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: carbon.map,
        bumpMap: carbon.bumpMap,
        bumpScale: 0.004,
        metalness: 0.22,
        roughness: 0.34,
        clearcoat: 1.0,
        clearcoatRoughness: 0.09,
        envMapIntensity: 1.15,
      })
    );

    this.materials.set(
      'cobalt',
      new THREE.MeshPhysicalMaterial({
        color: 0x2563eb,
        metalness: 0.88,
        roughness: 0.2,
        iridescence: 0.45,
        iridescenceIOR: 1.4,
        clearcoat: 0.6,
        clearcoatRoughness: 0.12,
        bumpMap: brushedBump,
        bumpScale: 0.0015,
        envMapIntensity: 1.35,
      })
    );

    this.materials.set(
      'sapphire',
      new THREE.MeshPhysicalMaterial({
        color: 0xb8f3ff,
        metalness: 0.04,
        roughness: 0.06,
        transmission: this.isSoftwareGl ? 0 : 0.88,
        transparent: true,
        opacity: this.isSoftwareGl ? 0.42 : 1.0,
        ior: 1.77,
        thickness: 0.18,
        attenuationColor: new THREE.Color(0x38bdf8),
        attenuationDistance: 0.45,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.5,
      })
    );

    this.materials.set(
      'ceramic',
      new THREE.MeshPhysicalMaterial({
        color: 0xf4f1ec,
        map: ceramicMap,
        metalness: 0.06,
        roughness: 0.68,
        clearcoat: 0.25,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.9,
      })
    );

    this.materials.set(
      'gold',
      new THREE.MeshPhysicalMaterial({
        color: 0xf5c242,
        metalness: 0.98,
        roughness: 0.15,
        anisotropy: 0.7,
        bumpMap: brushedBump,
        bumpScale: 0.0012,
        clearcoat: 0.2,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.4,
      })
    );
  }

  getPresetMaterial(id: MaterialPresetId): THREE.MeshPhysicalMaterial {
    return this.materials.get(id) ?? this.materials.get('titanium')!;
  }

  getAccentMaterial(
    key: string,
    params: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial {
    let mat = this.accentMaterials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial(params);
      this.accentMaterials.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    for (const tex of this.textures) tex.dispose();
    this.textures = [];
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    for (const mat of this.accentMaterials.values()) mat.dispose();
    this.accentMaterials.clear();
    this.envTexture?.dispose();
    this.envTexture = null;
  }
}
