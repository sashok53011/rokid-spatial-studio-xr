import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {ExportFormat} from '../types.ts';

export class UniversalModelIO {
  private gltfExporter = new GLTFExporter();
  private objExporter = new OBJExporter();
  private stlExporter = new STLExporter();
  private gltfLoader = new GLTFLoader();
  private objLoader = new OBJLoader();
  private stlLoader = new STLLoader();

  async exportObject(
    object: THREE.Object3D,
    format: ExportFormat,
    baseName = 'rokid-prototype'
  ): Promise<string> {
    if (format === 'glb') {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        this.gltfExporter.parse(
          object,
          (res) => {
            if (res instanceof ArrayBuffer) resolve(res);
            else {
              const json = JSON.stringify(res, null, 2);
              resolve(new TextEncoder().encode(json).buffer);
            }
          },
          (err) => reject(err),
          {binary: true}
        );
      });
      this.triggerDownload(
        new Blob([buffer], {type: 'model/gltf-binary'}),
        `${baseName}.glb`
      );
      return `${baseName}.glb (${(buffer.byteLength / 1024).toFixed(1)} KB)`;
    }

    if (format === 'obj') {
      const objText = this.objExporter.parse(object);
      const blob = new Blob([objText], {type: 'text/plain'});
      this.triggerDownload(blob, `${baseName}.obj`);
      return `${baseName}.obj (${(blob.size / 1024).toFixed(1)} KB)`;
    }

    const stlBuffer = this.stlExporter.parse(object, {binary: true}) as DataView;
    const stlBytes = new Uint8Array(
      stlBuffer.buffer,
      stlBuffer.byteOffset,
      stlBuffer.byteLength
    );
    const copy = new Uint8Array(stlBytes.length);
    copy.set(stlBytes);
    const blob = new Blob([copy.buffer], {type: 'application/octet-stream'});
    this.triggerDownload(blob, `${baseName}.stl`);
    return `${baseName}.stl (${(blob.size / 1024).toFixed(1)} KB)`;
  }

  promptFileImport(
    defaultMaterial: THREE.Material
  ): Promise<{name: string; group: THREE.Group} | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,.gltf,.obj,.stl';
      input.style.display = 'none';
      document.body.appendChild(input);

      const cleanup = () => input.remove();

      input.addEventListener('cancel', () => {
        cleanup();
        resolve(null);
      });

      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) {
          resolve(null);
          return;
        }
        try {
          const group = await this.parseFile(file, defaultMaterial);
          resolve({name: file.name, group});
        } catch (err) {
          reject(err);
        }
      });

      input.click();
    });
  }

  private async parseFile(
    file: File,
    defaultMaterial: THREE.Material
  ): Promise<THREE.Group> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const buffer = await file.arrayBuffer();
    let root: THREE.Group;

    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new Promise<{scene: THREE.Group}>((resolve, reject) => {
        this.gltfLoader.parse(buffer, '', resolve, reject);
      });
      root = gltf.scene;
    } else if (ext === 'obj') {
      const text = new TextDecoder().decode(buffer);
      root = this.objLoader.parse(text);
    } else if (ext === 'stl') {
      const geometry = this.stlLoader.parse(buffer);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, defaultMaterial);
      root = new THREE.Group();
      root.add(mesh);
    } else {
      throw new Error(`Unsupported 3D format: .${ext}`);
    }

    return this.normalizeImportedGroup(root, defaultMaterial, file.name);
  }

  private normalizeImportedGroup(
    rawRoot: THREE.Group,
    defaultMaterial: THREE.Material,
    name: string
  ): THREE.Group {
    const wrapper = new THREE.Group();
    wrapper.name = name;

    // Normalize scale to ~0.36m max extent and center bottom at y=0
    const box = new THREE.Box3().setFromObject(rawRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const targetScale = 0.36 / maxDim;

    rawRoot.scale.setScalar(targetScale);
    rawRoot.position.set(
      -center.x * targetScale,
      -box.min.y * targetScale,
      -center.z * targetScale
    );
    wrapper.add(rawRoot);

    rawRoot.updateMatrixWorld(true);
    const meshCenter = new THREE.Vector3();
    rawRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (!obj.material) obj.material = defaultMaterial;
        obj.userData.isPrimarySurface = true;
        obj.userData.basePosition = obj.position.clone();
        obj.geometry.computeBoundingBox();
        obj.geometry.boundingBox?.getCenter(meshCenter);
        const dir = meshCenter.clone().normalize();
        if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
        obj.userData.explodeVector = dir.multiplyScalar(0.18);
      }
    });

    return wrapper;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
