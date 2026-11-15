import * as THREE from 'three';
import {MaterialLibrary} from '../materials/MaterialLibrary.ts';
import {MaterialPresetId, PrototypeId} from '../types.ts';

export interface BuiltPrototype {
  id: Exclude<PrototypeId, 'imported'>;
  name: string;
  group: THREE.Group;
  animatedParts: THREE.Object3D[];
}

function tagPart(
  obj: THREE.Object3D,
  explodeVec: THREE.Vector3,
  isPrimarySurface = false
): void {
  obj.userData.basePosition = obj.position.clone();
  obj.userData.explodeVector = explodeVec;
  obj.userData.isPrimarySurface = isPrimarySurface;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (isPrimarySurface && child.userData.isPrimarySurface === undefined) {
        child.userData.isPrimarySurface = true;
      }
    }
  });
}

export class PrototypeFactory {
  private materials: MaterialLibrary;

  constructor(materials: MaterialLibrary) {
    this.materials = materials;
  }

  build(
    id: Exclude<PrototypeId, 'imported'>,
    presetId: MaterialPresetId
  ): BuiltPrototype {
    switch (id) {
      case 'turbine':
        return this.buildMicroTurbine(presetId);
      case 'canopy':
        return this.buildArchitecturalCanopy(presetId);
      case 'gimbal':
      default:
        return this.buildOpticalGimbal(presetId);
    }
  }

  applyMaterialPreset(root: THREE.Object3D, presetId: MaterialPresetId): void {
    const presetMat = this.materials.getPresetMaterial(presetId);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.isPrimarySurface) {
        obj.material = presetMat;
      }
    });
  }

  private buildOpticalGimbal(presetId: MaterialPresetId): BuiltPrototype {
    const group = new THREE.Group();
    group.name = 'Optical AR Gimbal Unit';

    const primaryMat = this.materials.getPresetMaterial(presetId);
    const darkRubberMat = this.materials.getAccentMaterial('matte-elastomer', {
      color: 0x16191f,
      roughness: 0.85,
      metalness: 0.05,
    });
    const copperCoilMat = this.materials.getAccentMaterial('copper-coil', {
      color: 0xd97706,
      roughness: 0.25,
      metalness: 0.92,
    });
    const opticLensMat = this.materials.getAccentMaterial('optic-cyan', {
      color: 0x38bdf8,
      roughness: 0.08,
      metalness: 0.15,
      emissive: 0x075985,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.85,
    });
    const ledRingMat = this.materials.getAccentMaterial('telemetry-ring', {
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.4,
      roughness: 0.3,
      metalness: 0.2,
    });

    // 1. Stepped Lathe Mounting Plinth (bottom-center grounded at y = 0)
    const lathePts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.16, 0.0),
      new THREE.Vector2(0.16, 0.025),
      new THREE.Vector2(0.13, 0.042),
      new THREE.Vector2(0.11, 0.068),
      new THREE.Vector2(0.0, 0.068),
    ];
    const basePlinth = new THREE.Mesh(
      new THREE.LatheGeometry(lathePts, 40),
      primaryMat
    );
    tagPart(basePlinth, new THREE.Vector3(0, -0.09, 0), true);
    group.add(basePlinth);

    // 2. Elastomer Isolation Gasket
    const gasket = new THREE.Mesh(
      new THREE.TorusGeometry(0.112, 0.01, 16, 40),
      darkRubberMat
    );
    gasket.rotation.x = Math.PI / 2;
    gasket.position.y = 0.072;
    tagPart(gasket, new THREE.Vector3(0, -0.04, 0), false);
    group.add(gasket);

    // 3. Rotary Servo Collar + Emissive Telemetry Ring
    const servoGroup = new THREE.Group();
    servoGroup.position.y = 0.1;
    const servoDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.098, 0.048, 36),
      copperCoilMat
    );
    const ledRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.093, 0.0045, 12, 48),
      ledRingMat
    );
    ledRing.rotation.x = Math.PI / 2;
    ledRing.position.y = 0.022;
    servoGroup.add(servoDrum, ledRing);
    tagPart(servoGroup, new THREE.Vector3(0, 0.02, 0), false);
    group.add(servoGroup);

    // 4. Dual Extruded Beveled Yoke Arms
    const armShape = new THREE.Shape();
    armShape.moveTo(-0.025, 0);
    armShape.lineTo(0.025, 0);
    armShape.lineTo(0.032, 0.14);
    armShape.lineTo(0.014, 0.185);
    armShape.lineTo(-0.014, 0.185);
    armShape.lineTo(-0.032, 0.14);
    armShape.closePath();

    const armGeo = new THREE.ExtrudeGeometry(armShape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.005,
      bevelSegments: 2,
    });
    armGeo.center();

    const leftYoke = new THREE.Mesh(armGeo, primaryMat);
    leftYoke.position.set(-0.125, 0.21, 0);
    leftYoke.rotation.y = Math.PI / 2;
    tagPart(leftYoke, new THREE.Vector3(-0.12, 0.05, 0), true);
    group.add(leftYoke);

    const rightYoke = new THREE.Mesh(armGeo.clone(), primaryMat);
    rightYoke.position.set(0.125, 0.21, 0);
    rightYoke.rotation.y = Math.PI / 2;
    tagPart(rightYoke, new THREE.Vector3(0.12, 0.05, 0), true);
    group.add(rightYoke);

    // 5. Primary Optical Sensor Barrel (pivot assembly)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.086, 0.092, 0.18, 36),
      primaryMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.255, 0);
    tagPart(barrel, new THREE.Vector3(0, 0.11, 0), true);
    group.add(barrel);

    // 6. Front Sapphire Objective Dome + Inner Aperture Ring
    const opticDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.072, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5),
      opticLensMat
    );
    opticDome.rotation.x = Math.PI / 2;
    opticDome.position.set(0, 0.255, 0.088);
    tagPart(opticDome, new THREE.Vector3(0, 0.11, 0.16), false);
    group.add(opticDome);

    const apertureBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.078, 0.008, 16, 36),
      darkRubberMat
    );
    apertureBezel.position.set(0, 0.255, 0.092);
    tagPart(apertureBezel, new THREE.Vector3(0, 0.11, 0.12), false);
    group.add(apertureBezel);

    // 7. Rear Heat-Sink Fins Array (6 fins grouped)
    const finsGroup = new THREE.Group();
    finsGroup.position.set(0, 0.255, -0.105);
    const finGeo = new THREE.BoxGeometry(0.13, 0.008, 0.04);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(finGeo, copperCoilMat);
      fin.position.y = i * 0.022;
      finsGroup.add(fin);
    }
    tagPart(finsGroup, new THREE.Vector3(0, 0.11, -0.15), false);
    group.add(finsGroup);

    // 8. Top LiDAR Depth Pod + Braided Conduit Tube
    const lidarPod = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.024, 0.055, 8, 20),
      primaryMat
    );
    lidarPod.rotation.x = Math.PI / 2;
    lidarPod.position.set(0, 0.365, 0.015);
    tagPart(lidarPod, new THREE.Vector3(0, 0.22, 0.03), true);
    group.add(lidarPod);

    const conduitCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.075, 0.11, -0.02),
      new THREE.Vector3(0.145, 0.15, -0.06),
      new THREE.Vector3(0.125, 0.24, -0.06),
      new THREE.Vector3(0.055, 0.26, -0.08),
    ]);
    const conduit = new THREE.Mesh(
      new THREE.TubeGeometry(conduitCurve, 28, 0.009, 10, false),
      darkRubberMat
    );
    tagPart(conduit, new THREE.Vector3(0.1, 0.04, -0.08), false);
    group.add(conduit);

    return {
      id: 'gimbal',
      name: 'Optical AR Gimbal Unit',
      group,
      animatedParts: [servoGroup],
    };
  }

  private buildMicroTurbine(presetId: MaterialPresetId): BuiltPrototype {
    const group = new THREE.Group();
    group.name = 'Aerospace Micro-Turbine';

    const primaryMat = this.materials.getPresetMaterial(presetId);
    const statorMat = this.materials.getAccentMaterial('turbine-stator', {
      color: 0x334155,
      roughness: 0.42,
      metalness: 0.82,
    });
    const bladeMat = this.materials.getAccentMaterial('turbine-blade', {
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.94,
    });
    const thermalGlowMat = this.materials.getAccentMaterial('afterburner-glow', {
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 1.25,
      roughness: 0.35,
      metalness: 0.25,
    });

    // 1. Cradle Pedestal
    const cradle = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.04, 0.28),
      statorMat
    );
    cradle.position.y = 0.02;
    tagPart(cradle, new THREE.Vector3(0, -0.1, 0), false);
    group.add(cradle);

    // 2. Twin Mounting Struts
    const strutGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.14, 16);
    const strutFront = new THREE.Mesh(strutGeo, statorMat);
    strutFront.position.set(0, 0.095, 0.075);
    tagPart(strutFront, new THREE.Vector3(0, -0.04, 0.06), false);
    group.add(strutFront);

    const strutBack = new THREE.Mesh(strutGeo.clone(), statorMat);
    strutBack.position.set(0, 0.095, -0.075);
    tagPart(strutBack, new THREE.Vector3(0, -0.04, -0.06), false);
    group.add(strutBack);

    // 3. Outer Aerodynamic Nacelle Shroud (Lathe hollow profile)
    const nacellePts = [
      new THREE.Vector2(0.115, -0.16),
      new THREE.Vector2(0.135, -0.12),
      new THREE.Vector2(0.145, 0.0),
      new THREE.Vector2(0.138, 0.12),
      new THREE.Vector2(0.118, 0.16),
    ];
    const nacelle = new THREE.Mesh(
      new THREE.LatheGeometry(nacellePts, 48),
      primaryMat
    );
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.y = 0.23;
    tagPart(nacelle, new THREE.Vector3(0, 0.12, 0), true);
    group.add(nacelle);

    // 4. Intake Lip Ring
    const intakeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.014, 16, 48),
      bladeMat
    );
    intakeRing.position.set(0, 0.23, 0.162);
    tagPart(intakeRing, new THREE.Vector3(0, 0.12, 0.16), false);
    group.add(intakeRing);

    // 5. Spinning 12-Blade Impeller Hub
    const rotorGroup = new THREE.Group();
    rotorGroup.position.set(0, 0.23, 0.08);
    const noseCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.042, 0.11, 28),
      primaryMat
    );
    noseCone.rotation.x = Math.PI / 2;
    noseCone.position.z = 0.035;
    rotorGroup.add(noseCone);

    const bladeGeo = new THREE.BoxGeometry(0.016, 0.082, 0.005);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(Math.cos(angle) * 0.068, Math.sin(angle) * 0.068, 0);
      blade.rotation.z = angle + Math.PI / 2;
      blade.rotation.y = 0.42;
      rotorGroup.add(blade);
    }
    tagPart(rotorGroup, new THREE.Vector3(0, 0.12, 0.09), false);
    group.add(rotorGroup);

    // 6. Combustion Core + Exhaust Glow Ring
    const coreChamber = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.092, 0.2, 32),
      statorMat
    );
    coreChamber.rotation.x = Math.PI / 2;
    coreChamber.position.set(0, 0.23, -0.04);
    tagPart(coreChamber, new THREE.Vector3(0, 0.12, -0.06), false);
    group.add(coreChamber);

    const exhaustNozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.072, 0.08, 32, 1, true),
      primaryMat
    );
    exhaustNozzle.rotation.x = Math.PI / 2;
    exhaustNozzle.position.set(0, 0.23, -0.185);
    tagPart(exhaustNozzle, new THREE.Vector3(0, 0.12, -0.18), true);
    group.add(exhaustNozzle);

    const glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.068, 0.008, 12, 36),
      thermalGlowMat
    );
    glowRing.position.set(0, 0.23, -0.19);
    tagPart(glowRing, new THREE.Vector3(0, 0.12, -0.22), false);
    group.add(glowRing);

    // 7. Top Fuel Manifold Tube
    const manifoldCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.08, 0.34, 0.07),
      new THREE.Vector3(0, 0.39, 0.0),
      new THREE.Vector3(0.08, 0.34, -0.07),
    ]);
    const manifold = new THREE.Mesh(
      new THREE.TubeGeometry(manifoldCurve, 24, 0.01, 10, false),
      bladeMat
    );
    tagPart(manifold, new THREE.Vector3(0, 0.22, 0), false);
    group.add(manifold);

    return {
      id: 'turbine',
      name: 'Aerospace Micro-Turbine',
      group,
      animatedParts: [rotorGroup],
    };
  }

  private buildArchitecturalCanopy(presetId: MaterialPresetId): BuiltPrototype {
    const group = new THREE.Group();
    group.name = 'Architectural Diagrid Canopy';

    const primaryMat = this.materials.getPresetMaterial(presetId);
    const concretePlinthMat = this.materials.getAccentMaterial('concrete-plinth', {
      color: 0x475569,
      roughness: 0.82,
      metalness: 0.08,
    });
    const timberDeckMat = this.materials.getAccentMaterial('timber-deck', {
      color: 0x9a6b42,
      roughness: 0.65,
      metalness: 0.04,
    });
    const skylightGlassMat = this.materials.getAccentMaterial('skylight-glass', {
      color: 0x7dd3fc,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
    });

    // 1. Stepped Plaza Foundation
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.028, 8),
      concretePlinthMat
    );
    plaza.position.y = 0.014;
    tagPart(plaza, new THREE.Vector3(0, -0.08, 0), false);
    group.add(plaza);

    // 2. Cantilevered Timber Viewing Deck
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.016, 0.18),
      timberDeckMat
    );
    deck.position.set(0.04, 0.042, 0);
    tagPart(deck, new THREE.Vector3(0.08, -0.02, 0), false);
    group.add(deck);

    // 3. Four Perimeter Structural Columns
    const colGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.22, 16);
    const colOffsets: [number, number][] = [
      [-0.14, -0.14],
      [0.14, -0.14],
      [0.14, 0.14],
      [-0.14, 0.14],
    ];
    colOffsets.forEach(([cx, cz]) => {
      const col = new THREE.Mesh(colGeo, primaryMat);
      col.position.set(cx, 0.135, cz);
      tagPart(col, new THREE.Vector3(cx * 0.7, 0.04, cz * 0.7), true);
      group.add(col);
    });

    // 4. Diagrid Roof Ring Frame
    const roofRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.205, 0.013, 14, 40),
      primaryMat
    );
    roofRing.rotation.x = Math.PI / 2;
    roofRing.position.y = 0.245;
    tagPart(roofRing, new THREE.Vector3(0, 0.12, 0), true);
    group.add(roofRing);

    // 5. Geodesic Glazed Skylight Dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.195, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42),
      skylightGlassMat
    );
    dome.position.y = 0.205;
    tagPart(dome, new THREE.Vector3(0, 0.22, 0), false);
    group.add(dome);

    // 6. Wireframe Structural Ribs Over Dome
    const ribMat = this.materials.getAccentMaterial('rib-steel', {
      color: 0xe2e8f0,
      roughness: 0.3,
      metalness: 0.85,
    });
    const ribsGroup = new THREE.Group();
    ribsGroup.position.y = 0.205;
    for (let i = 0; i < 4; i++) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(0.198, 0.004, 8, 32, Math.PI * 0.84),
        ribMat
      );
      arch.rotation.y = (i * Math.PI) / 4;
      arch.rotation.z = Math.PI * 0.08;
      ribsGroup.add(arch);
    }
    tagPart(ribsGroup, new THREE.Vector3(0, 0.27, 0), false);
    group.add(ribsGroup);

    return {
      id: 'canopy',
      name: 'Architectural Diagrid Canopy',
      group,
      animatedParts: [],
    };
  }
}
