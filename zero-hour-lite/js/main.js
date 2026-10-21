/* ZERO HOUR · bootstrap, main loop, state machine */
"use strict";

const Game = {
  state: "boot",       // boot | name | playing | levelup | dead
  canvas: null,
  ctx: null,
  W: 0, H: 0, dpr: 1,
  last: 0,
  paused: false,
  playerName: "",
  choices: [],
  deadReady: false,

  init() {
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    World.reset();
    Render.camX = 0; Render.camY = 0;

    UI.init();
    UI.startCb = () => this.startRun();

    Input.init(this.canvas);
    Input.onKey = (ev, down) => this.onKey(ev, down);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      this.paused = document.hidden;
      if (!document.hidden) this.last = performance.now();
    });

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    this.boot();
  },

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    Render.setup(this.W, this.H);
  },

  /* ------------------------------------------------------------- boot */
  async boot() {
    if (location.protocol === "file:") {
      UI.bootError("请通过服务器地址打开游戏，不要直接打开 index.html。");
      this.state = "boot";
      return;
    }
    UI.boot("正在检查玩家信息…");
    this.state = "boot";
    try {
      const info = await API.get("/api/player");
      if (info.registered) {
        this.playerName = info.name;
        UI.playerName = info.name;
        UI.hideBoot();
        this.startRun();
      } else {
        UI.hideBoot();
        this.state = "name";
        UI.showName();
      }
    } catch (err) {
      UI.bootError("");
      this.state = "boot";
    }
  },

  /* ------------------------------------------------------------ state */
  startRun() {
    this.playerName = UI.playerName || this.playerName || "";
    World.reset();
    Render.inited = false;
    Render.camX = World.player.x;
    Render.camY = World.player.y;
    UI.hideBoot();
    UI.hideName();
    UI.hideDead();
    UI.hideLevelUp();
    this.deadReady = false;
    this.choices = [];
    this.state = "playing";
    this.last = performance.now();
  },

  openLevelUp() {
    this.state = "levelup";
    this.choices = World.pickUpgrades(3);
    UI.showLevelUp(this.choices, (id) => this.chooseUpgrade(id));
  },

  chooseUpgrade(id) {
    World.applyUpgrade(id);
    World.pendingLevels = Math.max(0, World.pendingLevels - 1);
    this.last = performance.now();
    if (World.pendingLevels > 0) this.openLevelUp();
    else this.state = "playing";
  },

  onDeath() {
    this.state = "dead";
    SFX.over();
    const run = {
      elapsed: World.time,
      kills: World.kills,
      level: World.level,
      score: World.kills * 100 + World.level * 250 + Math.floor(World.time) * 5,
    };
    UI.showDead(run, () => this.startRun());
  },

  /* ------------------------------------------------------------ input */
  onKey(ev, down) {
    if (!down) return;
    const key = ev.key;

    if (key === "m" || key === "M") {
      const muted = SFX.toggle();
      UI.toast(muted ? "已静音" : "已开启声音", 900);
      return;
    }

    if (this.state === "levelup" && ["1", "2", "3"].includes(key)) {
      UI.pickIndex(parseInt(key, 10) - 1);
      return;
    }

    if (this.state === "dead" && key === "Enter" && this.deadReady) {
      this.startRun();
      return;
    }

    if (this.state === "name" && key === "Enter") {
      const input = document.getElementById("name-input");
      if (document.activeElement !== input) {
        ev.preventDefault();
        UI.submitName(input.value);
      }
      return;
    }

    if (this.state === "boot" && key === "Enter") {
      location.reload();
    }
  },

  /* ------------------------------------------------------------- loop */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    if (this.paused) dt = 0;

    if (this.state === "playing") {
      World.update(dt);
      if (World.dead) {
        this.onDeath();
      } else if (World.pendingLevels > 0) {
        this.openLevelUp();
      }
    }

    Render.draw(this.ctx, this.W, this.H, dt, this.dpr);
  },
};

window.addEventListener("DOMContentLoaded", () => Game.init());
window.addEventListener("contextmenu", (e) => e.preventDefault());
