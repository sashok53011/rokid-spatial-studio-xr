import * as THREE from 'three';
import * as xb from 'xrblocks';
import {CollaboratorState, SyncSessionState} from '../types.ts';

interface PeerAvatar {
  state: CollaboratorState;
  root: THREE.Group;
  visorMesh: THREE.Mesh;
  gazeLine: THREE.Line;
  badge: xb.UICard;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  targetGaze: THREE.Vector3;
}

const PEER_COLORS = [0x38bdf8, 0xa855f7, 0x34d399, 0xfbbf24];

export class CloudSyncManager extends xb.Script {
  readonly localPeerId: string;
  private channel: BroadcastChannel | null = null;
  private syncEnabled = true;
  private simulatedPeerActive = false;
  private simTime = 0;
  private lastBroadcastAt = 0;
  private peers = new Map<string, PeerAvatar>();
  private onRemoteStateReceived?: (state: SyncSessionState) => void;
  private onPeerCountChanged?: (count: number) => void;
  private focusPos = new THREE.Vector3(0, 1.15, -1.15);

  private readonly _tmpPos = new THREE.Vector3();
  private readonly _tmpQuat = new THREE.Quaternion();
  private readonly _tmpGaze = new THREE.Vector3();

  constructor(
    onRemoteStateReceived?: (state: SyncSessionState) => void,
    onPeerCountChanged?: (count: number) => void
  ) {
    super();
    this.localPeerId = `rokid-${Math.random().toString(36).slice(2, 7)}`;
    this.onRemoteStateReceived = onRemoteStateReceived;
    this.onPeerCountChanged = onPeerCountChanged;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('rokid-spatial-studio-v1');
      this.channel.onmessage = (event) => this.handleMessage(event.data);
    }
  }

  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    if (!enabled) {
      for (const id of [...this.peers.keys()]) {
        if (id !== 'sim-peer-01') this.removePeer(id);
      }
    }
  }

  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  toggleSimulatedCollaborator(): boolean {
    this.simulatedPeerActive = !this.simulatedPeerActive;
    if (!this.simulatedPeerActive) {
      this.removePeer('sim-peer-01');
    } else {
      this.upsertPeer({
        peerId: 'sim-peer-01',
        name: 'Elena · Rokid Max #2',
        device: 'Rokid Max + Station',
        colorHex: 0xa855f7,
        headPosition: [0.85, 1.56, -0.55],
        headQuaternion: [0, 0.35, 0, 0.93],
        pointerTarget: [0, 1.15, -1.15],
        lastSeen: performance.now(),
      });
    }
    return this.simulatedPeerActive;
  }

  isSimulatedCollaboratorActive(): boolean {
    return this.simulatedPeerActive;
  }

  broadcastState(state: Omit<SyncSessionState, 'senderId' | 'timestamp'>): void {
    if (!this.syncEnabled || !this.channel) return;
    const payload: SyncSessionState = {
      ...state,
      senderId: this.localPeerId,
      timestamp: Date.now(),
    };
    this.channel.postMessage({type: 'session-state', payload});
  }

  broadcastPose(
    headPos: THREE.Vector3,
    headQuat: THREE.Quaternion,
    pointerTarget: THREE.Vector3
  ): void {
    if (!this.syncEnabled || !this.channel) return;
    const now = performance.now();
    if (now - this.lastBroadcastAt < 65) return;
    this.lastBroadcastAt = now;

    const peerState: CollaboratorState = {
      peerId: this.localPeerId,
      name: `Unit ${this.localPeerId.slice(-4).toUpperCase()}`,
      device: 'Rokid Max WebXR',
      colorHex: PEER_COLORS[0],
      headPosition: [headPos.x, headPos.y, headPos.z],
      headQuaternion: [headQuat.x, headQuat.y, headQuat.z, headQuat.w],
      pointerTarget: [pointerTarget.x, pointerTarget.y, pointerTarget.z],
      lastSeen: Date.now(),
    };
    this.channel.postMessage({type: 'peer-pose', payload: peerState});
  }

  private handleMessage(msg: {type?: string; payload?: unknown}): void {
    if (!this.syncEnabled || !msg || !msg.type) return;
    if (msg.type === 'session-state') {
      const state = msg.payload as SyncSessionState;
      if (state.senderId === this.localPeerId) return;
      this.onRemoteStateReceived?.(state);
    } else if (msg.type === 'peer-pose') {
      const peer = msg.payload as CollaboratorState;
      if (peer.peerId === this.localPeerId) return;
      peer.lastSeen = performance.now();
      this.upsertPeer(peer);
    }
  }

  private upsertPeer(state: CollaboratorState): void {
    let avatar = this.peers.get(state.peerId);
    if (!avatar) {
      avatar = this.createPeerAvatar(state);
      this.peers.set(state.peerId, avatar);
      this.add(avatar.root);
      this.onPeerCountChanged?.(this.peers.size);
    }
    avatar.state = state;
    avatar.targetPos.set(...state.headPosition);
    avatar.targetQuat.set(...state.headQuaternion);
    avatar.targetGaze.set(...state.pointerTarget);
  }

  private createPeerAvatar(state: CollaboratorState): PeerAvatar {
    const root = new THREE.Group();
    root.name = `Peer_${state.peerId}`;
    root.xb = {pointerEvents: 'none'};

    // Stylized AR glasses visor representation
    const visorGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.75,
    });
    const lensMat = new THREE.MeshStandardMaterial({
      color: state.colorHex,
      emissive: state.colorHex,
      emissiveIntensity: 0.7,
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });

    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.036, 0.025),
      frameMat
    );
    const visorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.145, 0.03, 0.012),
      lensMat
    );
    visorMesh.position.z = -0.012;
    const templeL = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.012, 0.11),
      frameMat
    );
    templeL.position.set(-0.078, 0, 0.05);
    const templeR = templeL.clone();
    templeR.position.x = 0.078;
    visorGroup.add(bridge, visorMesh, templeL, templeR);
    root.add(visorGroup);

    // Gaze ray line (local origin to target)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -0.02),
      new THREE.Vector3(0, -0.2, -0.8),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: state.colorHex,
      transparent: true,
      opacity: 0.55,
    });
    const gazeLine = new THREE.Line(lineGeo, lineMat);
    root.add(gazeLine);

    // Floating Spatial Nameplate Card
    const badge = new xb.UICard({
      size: {width: 0.3, height: 0.072},
      pointerEvents: 'none',
      style: {
        padding: 8,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
      },
      children: [
        new xb.UIText({
          text: state.name,
          style: {fontSize: 16, fontWeight: 'bold', textAlign: 'center'},
        }),
      ],
    });
    badge.position.set(0, 0.1, 0);
    badge.add(new xb.FaceCamera({mode: 'spherical', smoothing: 0.2}));
    root.add(badge);

    root.position.set(...state.headPosition);
    root.quaternion.set(...state.headQuaternion);

    return {
      state,
      root,
      visorMesh,
      gazeLine,
      badge,
      targetPos: new THREE.Vector3(...state.headPosition),
      targetQuat: new THREE.Quaternion(...state.headQuaternion),
      targetGaze: new THREE.Vector3(...state.pointerTarget),
    };
  }

  private removePeer(peerId: string): void {
    const avatar = this.peers.get(peerId);
    if (!avatar) return;
    avatar.root.removeFromParent();
    avatar.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.peers.delete(peerId);
    this.onPeerCountChanged?.(this.peers.size);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  setFocusPoint(pos: THREE.Vector3): void {
    this.focusPos.copy(pos);
  }

  update(): void {
    const dt = Math.min(xb.getDeltaTime(), 0.05);
    const now = performance.now();

    if (this.simulatedPeerActive) {
      this.simTime += dt;
      const simAvatar = this.peers.get('sim-peer-01');
      if (simAvatar) {
        simAvatar.state.lastSeen = now;
        const focus = this.focusPos;
        simAvatar.targetPos.set(
          focus.x + 0.85 + Math.sin(this.simTime * 0.65) * 0.22,
          1.56 + Math.sin(this.simTime * 1.2) * 0.03,
          focus.z + 0.65 + Math.cos(this.simTime * 0.65) * 0.15
        );
        simAvatar.targetGaze.set(
          focus.x + Math.sin(this.simTime * 1.1) * 0.08,
          focus.y + 0.16,
          focus.z
        );
        // Orient visor toward prototype
        const lookMat = new THREE.Matrix4().lookAt(
          simAvatar.targetPos,
          simAvatar.targetGaze,
          this._tmpPos.set(0, 1, 0)
        );
        simAvatar.targetQuat.setFromRotationMatrix(lookMat);
      }
    }

    const alpha = 1 - Math.exp(-8 * dt);
    for (const [id, avatar] of this.peers.entries()) {
      if (id !== 'sim-peer-01' && now - avatar.state.lastSeen > 5000) {
        this.removePeer(id);
        continue;
      }
      avatar.root.position.lerp(avatar.targetPos, alpha);
      avatar.root.quaternion.slerp(avatar.targetQuat, alpha);

      // Update local gaze ray endpoint in avatar space
      this._tmpGaze.copy(avatar.targetGaze);
      avatar.root.worldToLocal(this._tmpGaze);
      const posAttr = avatar.gazeLine.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      posAttr.setXYZ(1, this._tmpGaze.x, this._tmpGaze.y, this._tmpGaze.z);
      posAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const id of [...this.peers.keys()]) {
      this.removePeer(id);
    }
    this.channel?.close();
    this.channel = null;
  }
}
