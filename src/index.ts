import './polyfills/quiet-capacitor.ts';
import './polyfills/webxr.ts';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as xb from 'xrblocks';
import {SpatialStudioApp} from './SpatialStudioApp.ts';

async function start(): Promise<void> {
  const options = new xb.Options();
  options.setAppTitle('Rokid Spatial Studio XR');
  options.setAppDescription(
    'Virtual prototyping, 4x 360° spatial cameras, PBR materials, Rapier3D physics & multi-user sync for AR glasses.'
  );

  // Spatial display, camera stream, reticles, hands & low-latency gestures
  options.enableCamera('environment');
  options.enableReticles();
  options.enableHands();
  options.enableGestures();
  options.gestures.setGestureEnabled('point', true);
  options.gestures.setGestureEnabled('spread', true);
  options.enableXRTransitions();

  // Environment depth mapping & physics mesh collider (battery-tuned default)
  options.depth = new xb.DepthOptions(xb.xrDepthMeshPhysicsOptions);
  options.depth.depthMesh.opacity = 0;
  options.depth.depthMesh.colliderUpdateFps = 8;
  options.depth.matchDepthView = false;
  options.reticles.projectOnDepthMesh = true;

  // Real-time Rapier3D physics engine
  options.physics.RAPIER = RAPIER;

  xb.add(new SpatialStudioApp());
  await xb.init(options);
}

document.addEventListener('DOMContentLoaded', () => {
  void start();
});
