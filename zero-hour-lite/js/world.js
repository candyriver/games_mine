/* ZERO HOUR · world simulation: player, enemies, bullets, gems, upgrades */
"use strict";

const UPGRADES = [
  { id: "speed",     name: "迅捷步伐", desc: "移动速度 +15%" },
  { id: "damage",    name: "锋利弹头", desc: "攻击伤害 +25%" },
  { id: "rate",      name: "快速装填", desc: "攻击速度 +20%" },
  { id: "heal",      name: "生命精华", desc: "恢复 30 点生命" },
  { id: "magnet",    name: "磁力核心", desc: "经验拾取范围 +35%" },
  { id: "multishot", name: "多重射击", desc: "额外发射一枚弹丸" },
];

const MAX_STACKS = { speed: 5, damage: 10, rate: 6, heal: 99, magnet: 4, multishot: 4 };

const ENEMY_TYPES = {
  grunt:  { r: 13, hp: 26,  speed: 66,  dmg: 5,  xp: 1,  color: "#d96868", glow: "#ff8a8d" },
  runner: { r: 11, hp: 16,  speed: 125, dmg: 3,  xp: 1,  color: "#ff8a61", glow: "#ffc08a" },
  brute:  { r: 21, hp: 78,  speed: 55,  dmg: 10, xp: 3,  color: "#ef6571", glow: "#ff9aa2" },
  elite:  { r: 30, hp: 420, speed: 62,  dmg: 16, xp: 14, color: "#ffe28a", glow: "#fff3c4", elite: true },
};

const World = {
  W: 0,            // viewport size in CSS pixels (set by main)
  H: 0,
  zoom: 1,
  enemies: [],
  bullets: [],
  gems: [],
  parts: [],
  texts: [],
  time: 0,
  kills: 0,
  level: 1,
  xp: 0,
  xpNeed: 6,
  spawnTimer: 1.1,
  eliteTimer: 55,
  burstTimer: 26,
  shake: 0,
  dead: false,
  hpFlash: 0,
  pendingLevels: 0,
  taken: { speed: 0, damage: 0, rate: 0, heal: 0, magnet: 0, multishot: 0 },
  player: null,
  _grid: new Map(),
  CELL: 72,

  reset() {
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.gems.length = 0;
    this.parts.length = 0;
    this.texts.length = 0;
    this.time = 0; this.kills = 0; this.level = 1; this.xp = 0;
    this.xpNeed = 6;
    this.spawnTimer = 1.1; this.eliteTimer = 55; this.burstTimer = 26;
    this.shake = 0; this.dead = false; this.hpFlash = 0; this.pendingLevels = 0;
    this.taken = { speed: 0, damage: 0, rate: 0, heal: 0, magnet: 0, multishot: 0 };
    this.player = {
      x: 0, y: 0, r: 15,
      hp: 120, maxHp: 120,
      speed: 205,
      dmg: 15,
      fireInterval: 0.53,
      fireCd: 0.35,
      bullets: 1,
      magnet: 120,
      iframes: 0,
      aim: 0,
      muzzle: 0,
    };

    // a small opening wave, so the first seconds are not empty
    for (let i = 0; i < 4; i++) {
      this.spawnEnemy("grunt", (i / 4) * Math.PI * 2 + 0.35, 460);
    }
  },

  /* ------------------------------------------------------------ spawning */
  spawnEdgePoint(ang) {
    // just outside the visible rectangle, so nothing pops in on screen
    const p = this.player;
    const hw = this.W / this.zoom / 2 + 60;
    const hh = this.H / this.zoom / 2 + 60;
    const c = Math.cos(ang), s = Math.sin(ang);
    const t = Math.min(hw / Math.max(Math.abs(c), 1e-6), hh / Math.max(Math.abs(s), 1e-6));
    return { x: p.x + c * t, y: p.y + s * t };
  },

  spawnEnemy(typeName, atAngle, radius) {
    const t = ENEMY_TYPES[typeName];
    const p = this.player;
    const ang = atAngle != null ? atAngle : Math.random() * Math.PI * 2;
    const pt = radius != null
      ? { x: p.x + Math.cos(ang) * radius, y: p.y + Math.sin(ang) * radius }
      : this.spawnEdgePoint(ang);
    const hpMul = 1 + this.time / 110 + Math.pow(this.time / 320, 2) * 1.6;
    const e = {
      type: typeName,
      x: pt.x,
      y: pt.y,
      vx: 0, vy: 0,
      r: t.r,
      hp: t.hp * hpMul,
      maxHp: t.hp * hpMul,
      speed: t.speed * (1 + Math.min(0.3, this.time / 1000)),
      dmg: t.dmg,
      xp: t.xp,
      color: t.color,
      glow: t.glow,
      elite: !!t.elite,
      hitCd: 0,
      flash: 0,
      spawn: 0.55,
      wob: Math.random() * Math.PI * 2,
    };
    this.enemies.push(e);
    return e;
  },

  spawnRadius() {
    // representative distance used for culling and for the deliberate rings
    const hw = this.W / this.zoom / 2 + 60;
    const hh = this.H / this.zoom / 2 + 60;
    return Math.max(hw, hh);
  },

  updateSpawner(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemies.length < 200) {
      const t = this.time;
      const interval = Math.max(0.24, 1.00 - t * 0.0022) * U.rand(0.85, 1.2);
      this.spawnTimer = interval;
      const roll = Math.random();
      let type = "grunt";
      if (t > 25 && roll < 0.26) type = "runner";
      else if (t > 45 && roll > 0.86) type = "brute";
      this.spawnEnemy(type);
    }

    // periodic encirclement
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstTimer = Math.max(14, 30 - this.time * 0.03);
      const n = 8 + Math.floor(this.time / 60);
      const base = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        this.spawnEnemy("grunt", base + (i / n) * Math.PI * 2, this.spawnRadius());
      }
    }

    // elite waves
    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = Math.max(24, 38 - this.time * 0.02);
      const n = this.time > 180 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        this.spawnEnemy("elite", Math.random() * Math.PI * 2, this.spawnRadius());
      }
    }
  },

  /* ------------------------------------------------------------- combat */
  fire() {
    const p = this.player;
    // nearest enemy within range
    let best = null, bestD = 560 * 560;
    for (const e of this.enemies) {
      const d = U.dist2(p.x, p.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const ang = Math.atan2(best.y - p.y, best.x - p.x);
    p.aim = ang;
    p.muzzle = 0.09;
    const spread = 0.10;
    const n = p.bullets;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
      const a = ang + off;
      this.bullets.push({
        x: p.x + Math.cos(a) * (p.r + 8),
        y: p.y + Math.sin(a) * (p.r + 8),
        vx: Math.cos(a) * 660,
        vy: Math.sin(a) * 660,
        r: 4.5,
        dmg: p.dmg,
        life: 0.86,
      });
    }
    this.spawnParts(p.x + Math.cos(ang) * p.r, p.y + Math.sin(ang) * p.r, 3, "#fff1d8", 90, 0.18, 2);
    SFX.shot();
  },

  spawnParts(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = U.rand(speed * 0.35, speed);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: U.rand(life * 0.6, life), maxLife: life,
        color, size: U.rand(size * 0.6, size),
      });
    }
  },

  floatText(x, y, str, color, size) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, str, color: color || "#fff1d8", size: size || 14, life: 0.7, maxLife: 0.7 });
  },

  damageEnemy(e, dmg) {
    e.hp -= dmg;
    e.flash = 0.09;
    if (e.hp <= 0) this.killEnemy(e);
  },

  killEnemy(e) {
    const idx = this.enemies.indexOf(e);
    if (idx < 0) return;
    this.enemies.splice(idx, 1);
    this.kills++;
    this.spawnParts(e.x, e.y, e.elite ? 26 : 9, e.color, e.elite ? 240 : 170, 0.55, e.elite ? 5 : 3.2);
    this.gems.push({ x: e.x, y: e.y, v: e.xp, vx: 0, vy: 0, born: 0.25, t: Math.random() * 6 });
    if (e.elite) { this.shake = Math.max(this.shake, 5); SFX.kill(); }
    else SFX.hit();
  },

  addXp(v) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = Math.round(6 + (this.level - 1) * 2.4);
      this.pendingLevels++;
      SFX.gem();
    }
  },

  hurtPlayer(dmg, fromX, fromY) {
    const p = this.player;
    if (p.iframes > 0) return;
    p.hp -= dmg;
    p.iframes = 0.7;
    this.hpFlash = 0.35;
    this.shake = Math.max(this.shake, 7);
    SFX.hurt();
    const a = Math.atan2(p.y - fromY, p.x - fromX);
    p.x += Math.cos(a) * 6; p.y += Math.sin(a) * 6;
    this.spawnParts(p.x, p.y, 8, "#ff8a8d", 150, 0.4, 3);
    if (p.hp <= 0) { p.hp = 0; this.dead = true; }
  },

  /* ------------------------------------------------------------- upgrade */
  pickUpgrades(n) {
    const p = this.player;
    const pool = UPGRADES.filter((u) => {
      if ((this.taken[u.id] || 0) >= (MAX_STACKS[u.id] || 99)) return false;
      if (u.id === "heal") return p.hp < p.maxHp;
      return true;
    });
    const chosen = [];
    const bag = pool.slice();
    while (chosen.length < n && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
      chosen.push(bag.splice(i, 1)[0]);
    }
    // all capped: fall back to a heal card so the overlay is never empty
    const heal = UPGRADES.find((u) => u.id === "heal");
    while (chosen.length < n) chosen.push(heal);
    return chosen;
  },

  applyUpgrade(id) {
    const p = this.player;
    this.taken[id] = (this.taken[id] || 0) + 1;
    switch (id) {
      case "speed":     p.speed = Math.min(430, p.speed * 1.15); break;
      case "damage":    p.dmg *= 1.25; break;
      case "rate":      p.fireInterval = Math.max(0.12, p.fireInterval / 1.2); break;
      case "heal":      p.hp = Math.min(p.maxHp, p.hp + 30); break;
      case "magnet":    p.magnet = Math.min(520, p.magnet * 1.35); break;
      case "multishot": p.bullets = Math.min(6, p.bullets + 1); break;
    }
  },

  /* -------------------------------------------------------------- update */
  update(dt) {
    const p = this.player;
    this.time += dt;
    this.hpFlash = Math.max(0, this.hpFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 26);

    // movement
    const mv = Input.move();
    const speed = p.speed * (Math.hypot(mv.x, mv.y) > 0.02 ? 1 : 0);
    p.x += mv.x * speed * dt;
    p.y += mv.y * speed * dt;
    if (mv.x || mv.y) p.aim = Math.atan2(mv.y, mv.x);

    // timers
    p.fireCd -= dt;
    p.iframes = Math.max(0, p.iframes - dt);
    p.muzzle = Math.max(0, p.muzzle - dt);
    if (p.fireCd <= 0 && this.enemies.length) {
      this.fire();
      p.fireCd = p.fireInterval;
    }

    this.updateSpawner(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateGems(dt);

    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.94; q.vy *= 0.94;
      if (q.life <= 0) this.parts.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const q = this.texts[i];
      q.life -= dt; q.y -= 34 * dt;
      if (q.life <= 0) this.texts.splice(i, 1);
    }
  },

  updateEnemies(dt) {
    const p = this.player;
    const CELL = this.CELL;
    const grid = this._grid;
    grid.clear();

    for (const e of this.enemies) {
      if (e.spawn > 0) e.spawn -= dt;
      e.flash = Math.max(0, e.flash - dt);
      e.hitCd = Math.max(0, e.hitCd - dt);

      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      e.wob += dt * 2;
      const wobble = e.type === "runner" ? Math.sin(e.wob) * 0.25 : 0;
      const a = ang + wobble;
      const sp = e.speed * (e.spawn > 0 ? 0.15 : 1);
      e.x += Math.cos(a) * sp * dt;
      e.y += Math.sin(a) * sp * dt;

      // contact damage
      if (d < e.r + p.r + 2 && e.hitCd <= 0) {
        e.hitCd = 1.0;
        this.hurtPlayer(e.dmg, e.x, e.y);
      }

      const cx = Math.floor(e.x / CELL), cy = Math.floor(e.y / CELL);
      const key = cx + "," + cy;
      let list = grid.get(key);
      if (!list) { list = []; grid.set(key, list); }
      list.push(e);
    }

    // separation (same + neighbouring cells, keeps crowds readable)
    for (const e of this.enemies) {
      const cx = Math.floor(e.x / CELL), cy = Math.floor(e.y / CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(cx + ox + "," + (cy + oy));
          if (!list) continue;
          for (const o of list) {
            if (o === e) continue;
            const dx = o.x - e.x, dy = o.y - e.y;
            const min = e.r + o.r;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0.0001 && d2 < min * min) {
              const dd = Math.sqrt(d2);
              const push = (min - dd) * 0.5;
              e.x -= (dx / dd) * push; e.y -= (dy / dd) * push;
              o.x += (dx / dd) * push; o.y += (dy / dd) * push;
            }
          }
        }
      }
    }

    // cull strays that fell far behind
    const far = this.spawnRadius() * 1.8;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (U.dist2(e.x, e.y, p.x, p.y) > far * far) this.enemies.splice(i, 1);
    }
  },

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let hit = false;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        const rr = e.r + b.r;
        if (U.dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          this.damageEnemy(e, b.dmg);
          this.spawnParts(b.x, b.y, 3, e.glow, 120, 0.22, 2);
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) this.bullets.splice(i, 1);
    }
  },

  updateGems(dt) {
    const p = this.player;
    const pickR = p.r + 14;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.born = Math.max(0, g.born - dt);
      g.t += dt;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (g.born <= 0) {
        let pull = 0;
        if (d < p.magnet) {
          pull = U.lerp(230, 640, 1 - Math.min(1, d / p.magnet));
        } else {
          // slow homing, so shards left behind still trickle in
          pull = 95;
        }
        if (pull > 0) {
          const a = Math.atan2(p.y - g.y, p.x - g.x);
          g.x += Math.cos(a) * pull * dt;
          g.y += Math.sin(a) * pull * dt;
        }
      }
      if (d < pickR) {
        this.addXp(g.v);
        this.gems.splice(i, 1);
      }
    }
  },
};
