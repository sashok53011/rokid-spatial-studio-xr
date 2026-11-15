import type * as RAPIERType from '@dimforge/rapier3d-simd-compat';
import * as THREE from 'three';
import * as xb from 'xrblocks';

interface PhysicsBall {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  body: ReturnType<xb.Physics['blendedWorld']['createRigidBody']> | null;
  spawnTime: number;
}

const MAX_BALLS = 24;
const BALL_RADIUS = 0.032;
const BALL_LIFETIME_MS = 9000;

export class PhysicsSandbox extends xb.Script {
  private physics: xb.Physics | null = null;
  private balls: PhysicsBall[] = [];
  private nextIndex = 0;
  private floorBody: ReturnType<xb.Physics['blendedWorld']['createRigidBody']> | null =
    null;
  private pedestalBody: ReturnType<
    xb.Physics['blendedWorld']['createRigidBody']
  > | null = null;
  private ballGeometry: THREE.SphereGeometry;
  private gravityY = -9.81;
  private lastCollisionCount = 0;

  constructor() {
    super();
    this.ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 20, 16);
    const palette = [0x38bdf8, 0xf59e0b, 0x34d399, 0xa78bfa, 0xfb7185];
    for (let i = 0; i < MAX_BALLS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.25,
        metalness: 0.72,
      });
      const mesh = new THREE.Mesh(this.ballGeometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.xb = {pointerEvents: 'none'};
      this.add(mesh);
      this.balls.push({mesh, body: null, spawnTime: 0});
    }
  }

  initPhysics(physics: xb.Physics): void {
    this.physics = physics;
    const {RAPIER, blendedWorld} = physics;

    // Ground floor collider at y = 0
    const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0);
    this.floorBody = blendedWorld.createRigidBody(floorDesc);
    blendedWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(12, 0.05, 12).setRestitution(0.65),
      this.floorBody
    );

    // Prototype inspection pedestal / assembly collision volume
    const pedDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.05, -1.15);
    this.pedestalBody = blendedWorld.createRigidBody(pedDesc);
    blendedWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(0.22, 0.18, 0.22)
        .setRestitution(0.75)
        .setFriction(0.35),
      this.pedestalBody
    );
  }

  updatePedestalCollider(worldPos: THREE.Vector3, scale = 1): void {
    if (!this.pedestalBody) return;
    this.pedestalBody.setTranslation(
      {x: worldPos.x, y: worldPos.y + 0.16 * scale, z: worldPos.z},
      true
    );
  }

  setGravity(y: number): void {
    this.gravityY = y;
    if (this.physics?.blendedWorld) {
      (this.physics.blendedWorld as unknown as RAPIERType.World).gravity = {
        x: 0,
        y,
        z: 0,
      };
    }
  }

  getGravity(): number {
    return this.gravityY;
  }

  spawnProbe(position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (!this.physics?.initialized) return;
    const {RAPIER, blendedWorld} = this.physics;
    const slot = this.balls[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % MAX_BALLS;

    if (slot.body) {
      blendedWorld.removeRigidBody(slot.body);
      slot.body = null;
    }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setCcdEnabled(true);
    (bodyDesc as unknown as RAPIERType.RigidBodyDesc).setLinvel(
      velocity.x,
      velocity.y,
      velocity.z
    );
    const body = blendedWorld.createRigidBody(bodyDesc);
    blendedWorld.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setRestitution(0.76)
        .setFriction(0.3)
        .setDensity(1.5),
      body
    );

    slot.body = body;
    slot.spawnTime = performance.now();
    slot.mesh.position.copy(position);
    slot.mesh.visible = true;
    this.lastCollisionCount++;
  }

  triggerStressBurst(targetCenter: THREE.Vector3): void {
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const radius = 0.08 + (i % 3) * 0.06;
      pos.set(
        targetCenter.x + Math.cos(angle) * radius,
        targetCenter.y + 0.72 + (i % 4) * 0.09,
        targetCenter.z + Math.sin(angle) * radius
      );
      vel.set(
        (Math.random() - 0.5) * 0.4,
        -0.5 - Math.random() * 0.5,
        (Math.random() - 0.5) * 0.4
      );
      this.spawnProbe(pos, vel);
    }
  }

  clearAll(): void {
    if (!this.physics?.blendedWorld) return;
    for (const slot of this.balls) {
      if (slot.body) {
        this.physics.blendedWorld.removeRigidBody(slot.body);
        slot.body = null;
      }
      slot.mesh.visible = false;
    }
  }

  getActiveProbeCount(): number {
    let count = 0;
    for (const slot of this.balls) {
      if (slot.body && slot.mesh.visible) count++;
    }
    return count;
  }

  physicsStep(): void {
    if (!this.physics?.initialized) return;
    const now = performance.now();
    for (const slot of this.balls) {
      if (!slot.body || !slot.mesh.visible) continue;
      if (now - slot.spawnTime > BALL_LIFETIME_MS) {
        this.physics.blendedWorld.removeRigidBody(slot.body);
        slot.body = null;
        slot.mesh.visible = false;
        continue;
      }
      const t = slot.body.translation();
      const r = slot.body.rotation();
      slot.mesh.position.set(t.x, t.y, t.z);
      slot.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    this.clearAll();
    if (this.physics?.blendedWorld) {
      if (this.floorBody) {
        this.physics.blendedWorld.removeRigidBody(this.floorBody);
        this.floorBody = null;
      }
      if (this.pedestalBody) {
        this.physics.blendedWorld.removeRigidBody(this.pedestalBody);
        this.pedestalBody = null;
      }
    }
    this.ballGeometry.dispose();
    for (const slot of this.balls) {
      slot.mesh.material.dispose();
    }
    this.balls = [];
  }
}
