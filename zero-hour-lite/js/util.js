/* ZERO HOUR · core utilities, input, audio  (no dependencies) */
"use strict";

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  dist2: (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  },
  angle: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
  fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  },
  fmtLv(v, w) {
    return String(v).padStart(w || 3, "0");
  },
  // rounded rectangle path
  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  },
};

/* ---------------------------------------------------------------- input */
const Input = {
  keys: Object.create(null),
  joy: { active: false, id: null, bx: 0, by: 0, kx: 0, ky: 0, dx: 0, dy: 0 },
  onKey: null, // set by main
  _touch: ("ontouchstart" in window) || navigator.maxTouchPoints > 0,

  init(canvas) {
    window.addEventListener("keydown", (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      this.keys[k] = true;
      if (this.onKey) this.onKey(e, true);
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys[k] = false;
      if (this.onKey) this.onKey(e, false);
    });
    window.addEventListener("blur", () => { this.keys = Object.create(null); this.release(); });

    const pos = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    canvas.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      const p = pos(ev);
      // joystick zone: left half, lower 70% of the screen
      if (p.x < canvas.clientWidth * 0.5 && p.y > canvas.clientHeight * 0.3) {
        this.joy.active = true;
        this.joy.id = ev.pointerId;
        this.joy.bx = p.x; this.joy.by = p.y;
        this.joy.kx = p.x; this.joy.ky = p.y;
        this.joy.dx = 0; this.joy.dy = 0;
        canvas.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      }
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!this.joy.active || ev.pointerId !== this.joy.id) return;
      const p = pos(ev);
      let dx = p.x - this.joy.bx, dy = p.y - this.joy.by;
      const len = Math.hypot(dx, dy);
      const max = 56;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      this.joy.kx = this.joy.bx + dx;
      this.joy.ky = this.joy.by + dy;
      const mag = Math.min(1, len / max);
      if (len > 0.001) { this.joy.dx = (dx / Math.max(len, 1e-6)) * mag; this.joy.dy = (dy / Math.max(len, 1e-6)) * mag; }
      ev.preventDefault();
    });
    const end = (ev) => {
      if (ev.pointerId === this.joy.id) this.release();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  },

  release() {
    this.joy.active = false; this.joy.id = null;
    this.joy.dx = 0; this.joy.dy = 0;
  },

  /* normalized movement direction */
  move() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k["a"] || k["ArrowLeft"]) x -= 1;
    if (k["d"] || k["ArrowRight"]) x += 1;
    if (k["w"] || k["ArrowUp"]) y -= 1;
    if (k["s"] || k["ArrowDown"]) y += 1;
    if (x === 0 && y === 0 && this.joy.active) { x = this.joy.dx; y = this.joy.dy; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, len: Math.min(1, len) };
  },

  isTouch() {
    try {
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    } catch (e) {
      return false;
    }
  },
};

/* ---------------------------------------------------------------- audio */
const SFX = {
  ctx: null,
  muted: localStorage.getItem("zeroHour.muted") === "1",
  master: null,

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
  },

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem("zeroHour.muted", this.muted ? "1" : "0");
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  },

  blip(freq, dur, type, gain, slideTo) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.3 : gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  shot() { this.blip(760, 0.06, "square", 0.12, 420); },
  hit() { this.blip(260, 0.05, "triangle", 0.10, 180); },
  kill() { this.blip(150, 0.10, "sawtooth", 0.10, 70); },
  gem() { this.blip(980, 0.05, "sine", 0.08, 1400); },
  hurt() { this.blip(120, 0.18, "sawtooth", 0.20, 60); },
  levelup() {
    this.blip(520, 0.10, "sine", 0.16, 780);
    setTimeout(() => this.blip(780, 0.14, "sine", 0.16, 1040), 90);
    setTimeout(() => this.blip(1040, 0.18, "sine", 0.14, 1300), 190);
  },
  over() {
    this.blip(300, 0.25, "sawtooth", 0.18, 120);
    setTimeout(() => this.blip(180, 0.45, "sawtooth", 0.16, 60), 160);
  },
};
