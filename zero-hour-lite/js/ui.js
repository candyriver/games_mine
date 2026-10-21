/* ZERO HOUR · DOM screens, networking, leaderboard */
"use strict";

const API = {
  async get(path) {
    const r = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || "http " + r.status); e.data = data; throw e; }
    return data;
  },
};

const UI = {
  el: {},
  boarding: false,
  page: 1,
  perPage: 10,
  entries: [],
  myRun: null,
  toastTimer: 0,
  chooseCb: null,
  restartCb: null,
  offline: false,

  init() {
    const ids = ["boot", "boot-msg", "boot-err", "boot-retry", "name", "name-form", "name-input",
      "name-err", "name-submit", "levelup", "cards", "levelup-hint", "dead", "run-stats",
      "board", "prev", "next", "pinfo", "toast", "dead-hint"];
    for (const id of ids) this.el[id] = document.getElementById(id);

    this.el["boot-retry"].addEventListener("click", () => location.reload());
    this.el.next.addEventListener("click", () => this.turnPage(1));
    this.el.prev.addEventListener("click", () => this.turnPage(-1));

    this.el["name-form"].addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const value = this.el["name-input"].value;
      await this.submitName(value);
    });

    // clicking empty space restarts on the run-over screen
    this.el.dead.addEventListener("click", (ev) => {
      if (ev.target.closest("#board") || ev.target.closest(".pager") || ev.target.closest("button")) return;
      if (this.deadReady && this.restartCb) this.restartCb();
    });

    if (Input.isTouch()) this.el["levelup-hint"].textContent = "点击卡片选择";
  },

  /* ------------------------------------------------------------- boot */
  boot(msg) {
    this.el["boot-err"].classList.add("hidden");
    this.el["boot-retry"].classList.add("hidden");
    this.el.boot.classList.remove("hidden");
    if (msg) this.el["boot-msg"].textContent = msg;
  },
  bootError(msg) {
    this.el["boot-msg"].textContent = "连接排行榜服务器失败，请重试。";
    this.el["boot-err"].textContent = msg || "确认服务端正在运行后按 Enter 重试";
    this.el["boot-err"].classList.remove("hidden");
    this.el["boot-retry"].classList.remove("hidden");
  },
  hideBoot() { this.el.boot.classList.add("hidden"); },

  /* ----------------------------------------------------------- name */
  showName() {
    this.el.name.classList.remove("hidden");
    this.el["name-err"].textContent = "";
    setTimeout(() => this.el["name-input"].focus(), 60);
  },
  hideName() { this.el.name.classList.add("hidden"); },

  async submitName(raw) {
    const name = String(raw || "").trim();
    if (!name) {
      this.el["name-err"].textContent = "名称不能为空，请输入玩家名称。";
      return false;
    }
    this.el["name-submit"].disabled = true;
    this.el["name-input"].disabled = true;
    this.el["name-err"].textContent = "正在保存玩家名称…";
    try {
      const data = await API.post("/api/register", { name });
      this.el["name-err"].textContent = "";
      this.hideName();
      this.playerName = data.name;
      if (this.startCb) this.startCb();
      return true;
    } catch (err) {
      this.el["name-err"].textContent =
        err.message === "name_must_be_1_to_16_characters"
          ? "名称需为 1-16 个字符。"
          : (err.data && err.data.error ? "登记失败，请稍后重试。" : "登记失败，请检查服务器后重试。");
      this.el["name-submit"].disabled = false;
      this.el["name-input"].disabled = false;
      this.el["name-input"].focus();
      return false;
    }
  },

  /* ------------------------------------------------------- level up */
  showLevelUp(choices, cb) {
    this.chooseCb = cb;
    const wrap = this.el.cards;
    wrap.innerHTML = "";
    choices.forEach((u, i) => {
      const card = document.createElement("button");
      card.className = "card";
      card.type = "button";
      card.innerHTML =
        `<span class="key">${i + 1}</span>` +
        `<span class="ctag">强化</span>` +
        `<span class="cname">${u.name}</span>` +
        `<span class="cdesc">${u.desc}</span>`;
      card.addEventListener("click", () => this.choose(u.id));
      wrap.appendChild(card);
    });
    this.el.levelup.classList.remove("hidden");
  },

  choose(id) {
    this.el.levelup.classList.add("hidden");
    const cb = this.chooseCb;
    this.chooseCb = null;
    if (cb) cb(id);
  },

  pickIndex(i) {
    const cards = this.el.cards.querySelectorAll(".card");
    if (!cards.length) return;
    const card = cards[i];
    if (card) card.click();
  },

  hideLevelUp() { this.el.levelup.classList.add("hidden"); },

  /* -------------------------------------------------------- run over */
  async showDead(run, restartCb) {
    this.restartCb = restartCb;
    this.deadReady = false;
    this.myRun = run;
    this.el["run-stats"].textContent =
      `存活 ${U.fmtTime(run.elapsed)}   ·   击杀 ${run.kills}   ·   等级 ${run.level}`;
    this.el.dead.classList.remove("hidden");
    this.el.board.innerHTML = '<div class="empty">正在同步排行榜…</div>';
    this.el.pinfo.textContent = "1 / 1 页";
    this.el.prev.disabled = true;
    this.el.next.disabled = true;

    let submitted = null;
    try {
      submitted = await API.post("/api/score", {
        elapsed: Math.floor(run.elapsed),
        kills: run.kills,
        level: run.level,
      });
      run.score = submitted.score;
    } catch (err) {
      this.toast("成绩暂时无法同步。");
    }

    await this.loadBoard();
    this.deadReady = true;
  },

  async loadBoard() {
    try {
      const data = await API.get("/api/leaderboard");
      this.entries = data.entries || [];
      this.page = 1;
      this.offline = false;
    } catch (err) {
      this.entries = [];
      this.offline = true;
    }
    this.renderBoard();
  },

  renderBoard() {
    const board = this.el.board;
    if (this.offline) {
      board.innerHTML = '<div class="empty">连接排行榜服务器失败，请重试。</div>';
      this.el.pinfo.textContent = "— / — 页";
      this.el.prev.disabled = true;
      this.el.next.disabled = true;
      return;
    }
    if (!this.entries.length) {
      board.innerHTML = '<div class="empty">暂无成绩记录</div>';
      this.el.pinfo.textContent = "1 / 1 页";
      this.el.prev.disabled = true;
      this.el.next.disabled = true;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.entries.length / this.perPage));
    this.page = U.clamp(this.page, 1, pages);
    const start = (this.page - 1) * this.perPage;
    const slice = this.entries.slice(start, start + this.perPage);

    board.innerHTML = "";
    slice.forEach((row, i) => {
      const rank = start + i + 1;
      const div = document.createElement("div");
      div.className = "row";
      const mine = this.myRun && this.myRun.score === row.score && this.myRun.kills === row.kills;
      if (mine) div.classList.add("me");
      div.innerHTML =
        `<span class="rank">${U.fmtLv(rank, 3)}</span>` +
        `<span class="nm"></span>` +
        `<span class="sc">${row.score} 分</span>` +
        `<span class="meta">${row.kills} 击杀 · Lv.${row.level} · ${U.fmtTime(row.elapsed)}</span>`;
      div.querySelector(".nm").textContent = row.name;
      board.appendChild(div);
    });
    this.el.pinfo.textContent = `${this.page} / ${pages} 页`;
    this.el.prev.disabled = this.page <= 1;
    this.el.next.disabled = this.page >= pages;
  },

  turnPage(delta) {
    const pages = Math.max(1, Math.ceil(this.entries.length / this.perPage));
    const next = U.clamp(this.page + delta, 1, pages);
    if (next === this.page) return;
    this.page = next;
    this.renderBoard();
  },

  hideDead() {
    this.el.dead.classList.add("hidden");
    this.deadReady = false;
  },

  /* ----------------------------------------------------------- toast */
  toast(msg, ms) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove("show"), ms || 1800);
  },
};
