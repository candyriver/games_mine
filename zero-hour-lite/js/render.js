/* ZERO HOUR · canvas renderer */
"use strict";

const Render = {
  camX: 0, camY: 0, zoom: 1, inited: false,
  font: 'system-ui, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',

  setup(W, H) {
    this.zoom = U.clamp(Math.min(W / 1180, H / 660), 0.68, 1.45);
    World.W = W; World.H = H; World.zoom = this.zoom;
  },

  center() {
    const p = World.player;
    if (!this.inited) { this.camX = p.x; this.camY = p.y; this.inited = true; }
    return { x: this.camX, y: this.camY };
  },

  draw(ctx, W, H, dt, dpr) {
    const p = World.player;
    const k = 1 - Math.exp(-dt * 9);
    this.camX += (p.x - this.camX) * k;
    this.camY += (p.y - this.camY) * k;

    const scale = dpr || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#0a1118";
    ctx.fillRect(0, 0, W, H);

    const shake = World.shake;
    const sx = shake ? U.rand(-shake, shake) : 0;
    const sy = shake ? U.rand(-shake, shake) : 0;

    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    const vw = W / this.zoom, vh = H / this.zoom;
    const left = this.camX - vw / 2, top = this.camY - vh / 2;
    const right = left + vw, bottom = top + vh;

    this.drawGrid(ctx, left, top, right, bottom);
    this.drawGems(ctx);
    this.drawBullets(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx, dt);
    this.drawParts(ctx);
    this.drawTexts(ctx);

    ctx.restore();

    // vignette + damage flash
    const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    if (World.hpFlash > 0) {
      ctx.fillStyle = `rgba(239,101,113,${0.16 * (World.hpFlash / 0.35)})`;
      ctx.fillRect(0, 0, W, H);
    }

    this.drawHud(ctx, W, H);
  },

  drawGrid(ctx, left, top, right, bottom) {
    const step = 80;
    ctx.strokeStyle = "#141d25";
    ctx.lineWidth = 1 / this.zoom;
    ctx.beginPath();
    const x0 = Math.floor(left / step) * step;
    for (let x = x0; x <= right; x += step) {
      ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    }
    const y0 = Math.floor(top / step) * step;
    for (let y = y0; y <= bottom; y += step) {
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();

    // subtle accent at origin
    ctx.strokeStyle = "rgba(114,239,210,0.10)";
    ctx.beginPath();
    ctx.moveTo(-24, 0); ctx.lineTo(24, 0);
    ctx.moveTo(0, -24); ctx.lineTo(0, 24);
    ctx.stroke();
  },

  drawGems(ctx) {
    for (const g of World.gems) {
      const s = 4.5 + Math.min(6, g.v * 0.7) + Math.sin(g.t * 4) * 0.8;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.t * 1.4);
      ctx.fillStyle = g.v >= 10 ? "#ffe28a" : "#5be0c1";
      ctx.shadowColor = g.v >= 10 ? "#ffe28a" : "#5be0c1";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.72, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.72, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },

  drawBullets(ctx) {
    ctx.save();
    ctx.shadowColor = "#fff1d8";
    ctx.shadowBlur = 10;
    for (const b of World.bullets) {
      const len = 12;
      const nx = b.vx / 660, ny = b.vy / 660;
      ctx.strokeStyle = "rgba(255,241,216,0.55)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x - nx * len, b.y - ny * len);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "#fff1d8";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  drawEnemies(ctx) {
    const p = World.player;
    for (const e of World.enemies) {
      const alpha = e.spawn > 0 ? U.clamp(1 - e.spawn / 0.55, 0.15, 1) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(e.x, e.y);

      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      ctx.rotate(ang);

      ctx.shadowColor = e.flash > 0 ? "#ffffff" : e.glow;
      ctx.shadowBlur = e.elite ? 16 : 7;
      ctx.fillStyle = e.flash > 0 ? "#ffffff" : e.color;

      if (e.type === "runner") {
        ctx.beginPath();
        ctx.moveTo(e.r * 1.25, 0);
        ctx.lineTo(-e.r * 0.8, e.r * 0.85);
        ctx.lineTo(-e.r * 0.8, -e.r * 0.85);
        ctx.closePath();
        ctx.fill();
      } else if (e.type === "brute" || e.elite) {
        const sides = e.elite ? 8 : 6;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2 + (e.elite ? World.time * 0.6 : 0);
          const rr = e.r * (e.elite ? 1 : 0.92);
          if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        if (e.elite) {
          ctx.strokeStyle = "#fff3c4";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(10,17,24,0.45)";
        ctx.lineWidth = 2;
        ctx.stroke();
        // small specular highlight, reads as an orb rather than a donut
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.beginPath();
        ctx.arc(-e.r * 0.3, -e.r * 0.32, e.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // elite hp bar
      if (e.elite) {
        const w = 64, h = 5;
        ctx.fillStyle = "rgba(10,17,24,0.8)";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w, h);
        ctx.fillStyle = "#ffe28a";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w * Math.max(0, e.hp / e.maxHp), h);
      }
    }
  },

  drawPlayer(ctx, dt) {
    const p = World.player;
    const blink = p.iframes > 0 && Math.floor(p.iframes * 22) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);

    // direction wedge
    ctx.fillStyle = "rgba(114,239,210,0.18)";
    ctx.beginPath();
    ctx.moveTo(p.r * 0.6, 0);
    ctx.lineTo(p.r * 2.1, -p.r * 0.55);
    ctx.lineTo(p.r * 2.1, p.r * 0.55);
    ctx.closePath();
    ctx.fill();

    // ring
    ctx.strokeStyle = "#72efd2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.stroke();

    // core
    ctx.shadowColor = "#72efd2";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#d5fff6";
    ctx.beginPath();
    ctx.arc(0, 0, p.r * 0.52, 0, Math.PI * 2);
    ctx.fill();

    // muzzle flash
    if (p.muzzle > 0) {
      ctx.fillStyle = "rgba(255,241,216," + (p.muzzle / 0.09) + ")";
      ctx.beginPath();
      ctx.arc(p.r * 0.9, 0, p.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  drawParts(ctx) {
    for (const q of World.parts) {
      const a = Math.max(0, q.life / q.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawTexts(ctx) {
    for (const t of World.texts) {
      const a = Math.max(0, t.life / t.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.font = `600 ${t.size}px ${this.font}`;
      ctx.textAlign = "center";
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  },

  /* ------------------------------------------------------------- HUD */
  drawHud(ctx, W, H) {
    const p = World.player;
    const pad = Math.max(16, Math.min(28, W * 0.025));

    // timer, top centre
    ctx.font = `700 24px ${this.font}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f4f1e8";
    ctx.fillText(U.fmtTime(World.time), W / 2, pad + 24);
    ctx.textAlign = "left";

    // LV + kills
    ctx.font = `600 15px ${this.font}`;
    ctx.fillStyle = "#ced9df";
    ctx.fillText(`LV. ${World.level}   ·   ${World.kills} 击杀`, pad, pad + 16);

    // HP bar
    const barW = Math.min(250, W * 0.32);
    const hpY = pad + 30;
    ctx.fillStyle = "#263641";
    U.roundRect(ctx, pad, hpY, barW, 10, 5);
    ctx.fill();
    const hpFrac = U.clamp(p.hp / p.maxHp, 0, 1);
    if (hpFrac > 0) {
      const g = ctx.createLinearGradient(pad, 0, pad + barW, 0);
      g.addColorStop(0, "#ef6571");
      g.addColorStop(1, "#ff8a8d");
      ctx.fillStyle = g;
      U.roundRect(ctx, pad, hpY, Math.max(6, barW * hpFrac), 10, 5);
      ctx.fill();
    }
    ctx.font = `500 12px ${this.font}`;
    ctx.fillStyle = "#d5e1e5";
    ctx.fillText(`生命  ${Math.ceil(p.hp)} / ${p.maxHp}`, pad + 2, hpY + 26);

    // XP bar, bottom
    const xpY = H - pad - 8;
    const xpH = 8;
    ctx.fillStyle = "#263641";
    U.roundRect(ctx, pad, xpY, W - pad * 2, xpH, xpH / 2);
    ctx.fill();
    const xpFrac = U.clamp(World.xp / World.xpNeed, 0, 1);
    if (xpFrac > 0) {
      ctx.fillStyle = "#5be0c1";
      U.roundRect(ctx, pad, xpY, Math.max(6, (W - pad * 2) * xpFrac), xpH, xpH / 2);
      ctx.fill();
    }
    ctx.font = `500 12px ${this.font}`;
    ctx.fillStyle = "#a8bbc1";
    ctx.fillText(`经验  ${Math.floor(World.xp)} / ${World.xpNeed}`, pad + 2, xpY - 8);

    // hint
    ctx.textAlign = "center";
    ctx.font = `400 12px ${this.font}`;
    ctx.fillStyle = "#6f848d";
    const hint = Input.isTouch()
      ? "拖动左下摇杆移动 · 自动攻击"
      : "WASD / 方向键 移动     自动攻击     收集碎片升级";
    ctx.fillText(hint, W / 2, xpY - 10);
    ctx.textAlign = "left";

    // joystick
    const j = Input.joy;
    if (j.active) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#72efd2";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(j.bx, j.by, 56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(114,239,210,0.16)";
      ctx.beginPath();
      ctx.arc(j.bx, j.by, 56, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#72efd2";
      ctx.beginPath();
      ctx.arc(j.kx, j.ky, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
};
