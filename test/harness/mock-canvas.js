// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// mock-canvas.js — a headless CanvasRenderingContext2D stand-in that TRACKS
// the two pieces of state whose corruption makes things "jump around the
// screen": the save()/restore() stack depth and the current transform matrix.
//
// Anything it does not need to model (paths, fills, text, gradients) is
// accepted and ignored, so the real engine can be driven unchanged.

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Multiply affine matrices: result = m * n  (canvas "post-multiply" order). */
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** A chainable do-nothing object (gradients, patterns, audio nodes …). */
export function autoMock(base = {}) {
  const store = Object.assign(Object.create(null), base);
  const fn = () => autoMock();
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "then") return undefined; // never look like a thenable
      if (prop in store) return store[prop];
      return (store[prop] = autoMock());
    },
    set(_t, prop, value) {
      store[prop] = value;
      return true;
    },
    apply() {
      return autoMock();
    },
  });
}

export class MockContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.reset();
    // Methods that change nothing we track but must exist and return sensible values.
    const noop = () => {};
    for (const m of [
      "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo",
      "bezierCurveTo", "arc", "arcTo", "ellipse", "rect", "roundRect",
      "fill", "stroke", "fillRect", "clearRect",
      "strokeText", "drawImage", "setLineDash", "putImageData",
    ]) this[m] = noop;
    this.createLinearGradient = () => autoMock();
    this.createRadialGradient = () => autoMock();
    this.createPattern = () => autoMock();
    this.measureText = (t) => ({ width: String(t).length * 6 });
    this.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h });
    this.getLineDash = () => [];
    this.isPointInPath = () => false;
    // Plain style properties (assignment is stored, reads return it).
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.font = "10px sans-serif";
    this.textAlign = "start";
    this.textBaseline = "alphabetic";
    this.globalCompositeOperation = "source-over";
    this.shadowBlur = 0;
    this.shadowColor = "transparent";
    this.lineCap = "butt";
    this.lineJoin = "miter";
    this.imageSmoothingEnabled = true;
  }

  /** Clear tracked state (keeps the object identity the engine captured). */
  reset() {
    this.m = [...IDENTITY];
    this.stack = [];
    this.underflows = 0;   // restore() with an empty stack (the canvas ignores it silently)
    this.maxDepth = 0;
    this.calls = 0;
    this.clipDepth = 0;    // number of clip() calls currently in force (restored by restore())
    this.ops = [];         // recorded strokeRect/fillText calls with the transform + clip state at call time
    this.recordOps = true;
  }

  /** Transform scale factor of the CURRENT matrix along x. */
  get scaleX() { return Math.hypot(this.m[0], this.m[1]); }

  get depth() { return this.stack.length; }
  get matrix() { return [...this.m]; }

  /** Map a point through the CURRENT transform to canvas pixels. */
  toCanvas(x, y) {
    const m = this.m;
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  save() {
    this.stack.push({ m: [...this.m], clipDepth: this.clipDepth, globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign });
    if (this.stack.length > this.maxDepth) this.maxDepth = this.stack.length;
    this.calls++;
  }

  restore() {
    this.calls++;
    const s = this.stack.pop();
    if (!s) { this.underflows++; return; }
    this.m = s.m;
    this.clipDepth = s.clipDepth;
    this.globalAlpha = s.globalAlpha;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.font = s.font;
    this.textAlign = s.textAlign;
  }

  clip() { this.clipDepth++; }
  strokeRect(x, y, w, h) { this._op("strokeRect", [x, y, w, h]); }
  fillText(text, x, y) { this._op("fillText", [text, x, y]); }
  _op(name, args) {
    if (!this.recordOps) return;
    if (this.ops.length > 5000) this.ops.shift();
    this.ops.push({ name, args, matrix: [...this.m], scale: this.scaleX, clipDepth: this.clipDepth, depth: this.stack.length });
  }

  translate(x, y) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); }
  rotate(a) {
    const c = Math.cos(a), s = Math.sin(a);
    this.m = mul(this.m, [c, s, -s, c, 0, 0]);
  }
  transform(a, b, c, d, e, f) { this.m = mul(this.m, [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) {
    if (a && typeof a === "object") { this.m = [a.a, a.b, a.c, a.d, a.e, a.f]; return; }
    this.m = [a, b, c, d, e, f];
  }
  resetTransform() { this.m = [...IDENTITY]; }
  getTransform() {
    const [a, b, c, d, e, f] = this.m;
    return { a, b, c, d, e, f };
  }
}

export { IDENTITY, mul };
