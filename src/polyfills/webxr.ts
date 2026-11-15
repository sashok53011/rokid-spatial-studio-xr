/**
 * Minimal WebXR polyfills for environments without WebXR (Capacitor WebView).
 *
 * xrblocks' Simulator references `XRRigidTransform` inside promises; without
 * the class it throws `ReferenceError: XRRigidTransform is not defined` in a
 * tight loop. This provides just enough surface for construction and matrix
 * access so the simulator degrades gracefully instead of spamming errors.
 */

interface XRRigidTransformLike {
  position: {x: number; y: number; z: number; w: number};
  orientation: {x: number; y: number; z: number; w: number};
  matrix: Float32Array;
  inverse: XRRigidTransformLike;
}

class XRRigidTransformPolyfill implements XRRigidTransformLike {
  position: {x: number; y: number; z: number; w: number};
  orientation: {x: number; y: number; z: number; w: number};
  matrix: Float32Array;
  private _inverse: XRRigidTransformPolyfill | null = null;

  constructor(
    position: {x?: number; y?: number; z?: number; w?: number} = {},
    orientation: {x?: number; y?: number; z?: number; w?: number} = {}
  ) {
    this.position = {
      x: position.x ?? 0,
      y: position.y ?? 0,
      z: position.z ?? 0,
      w: position.w ?? 1,
    };
    this.orientation = {
      x: orientation.x ?? 0,
      y: orientation.y ?? 0,
      z: orientation.z ?? 0,
      w: orientation.w ?? 1,
    };
    this.matrix = new Float32Array(16);
    this.matrix[0] = 1;
    this.matrix[5] = 1;
    this.matrix[10] = 1;
    this.matrix[15] = 1;
  }

  get inverse(): XRRigidTransformPolyfill {
    if (!this._inverse) {
      const q = this.orientation;
      this._inverse = new XRRigidTransformPolyfill(
        {x: -this.position.x, y: -this.position.y, z: -this.position.z},
        {x: -q.x, y: -q.y, z: -q.z, w: q.w}
      );
    }
    return this._inverse;
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.XRSystem === 'undefined') {
  // Not a WebXR environment at all (e.g. Capacitor WebView).
}
if (typeof g.XRRigidTransform === 'undefined') {
  g.XRRigidTransform = XRRigidTransformPolyfill;
}

export {};
