/* eslint-disable no-use-before-define */
(() => {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const bestEl = document.getElementById("best");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const soundBtn = document.getElementById("soundBtn");

  const GRID = 24; // cells per side
  const CELL = canvas.width / GRID; // integer with width=600, GRID=24 => 25px

  const BASE_TICK_MS = 135; // starting speed (lower = faster)
  const STORAGE_KEY_BEST = "snake_web_best_v1";
  const STORAGE_KEY_SOUND = "snake_web_sound_v1";

  const COLORS = {
    bg: "#0b1020",
    grid: "rgba(255,255,255,.035)",
    snakeHead: "#a78bfa",
    snakeBody: "rgba(167,139,250,.82)",
    food: "#22c55e",
    foodGlow: "rgba(34,197,94,.35)",
    text: "#eef2ff",
    bad: "#ef4444",
    obstacle: "rgba(248,113,113,.88)",
  };

  /** @type {{x:number,y:number}[]} */
  const obstacles = createObstacles();

  /** @type {number} */
  let best = clampInt(parseInt(localStorage.getItem(STORAGE_KEY_BEST) || "0", 10), 0, 999999);
  bestEl.textContent = String(best);

  /** @type {boolean} */
  let soundOn = (localStorage.getItem(STORAGE_KEY_SOUND) ?? "1") === "1";
  updateSoundBtn();

  /** @type {"idle"|"running"|"paused"|"gameover"} */
  let state = "idle";

  /** @type {{x:number,y:number}[]} */
  let snake = [];
  /** @type {{x:number,y:number}} */
  let dir = { x: 1, y: 0 };
  /** @type {{x:number,y:number}} */
  let nextDir = { x: 1, y: 0 };
  /** @type {{x:number,y:number}} */
  let food = { x: 12, y: 12 };
  /** @type {number} */
  let score = 0;
  /** @type {number} */
  let level = 1;

  let lastTickAt = 0;
  let tickMs = BASE_TICK_MS;

  // Audio (tiny beeps via WebAudio)
  /** @type {AudioContext | null} */
  let audioCtx = null;
  function beep(freq, durationMs, type = "sine", gain = 0.06) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + durationMs / 1000);
    } catch {
      // ignore audio errors (autoplay policies etc.)
    }
  }

  function showOverlay(title, bodyHtml) {
    overlayTitleEl.textContent = title;
    overlayBodyEl.innerHTML = bodyHtml;
    overlayEl.classList.remove("hidden");
  }
  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function resetGame() {
    score = 0;
    scoreEl.textContent = "0";
    level = 1;
    levelEl.textContent = "1";
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };

    const start = { x: Math.floor(GRID / 2) - 2, y: Math.floor(GRID / 2) + 4 };
    snake = [
      { x: start.x + 2, y: start.y },
      { x: start.x + 1, y: start.y },
      { x: start.x + 0, y: start.y },
    ];

    food = placeFood();
    updateDifficulty();
    lastTickAt = performance.now();
  }

  function start() {
    resetGame();
    state = "running";
    hideOverlay();
    beep(520, 70, "triangle", 0.05);
  }

  function pauseToggle() {
    if (state === "running") {
      state = "paused";
      showOverlay("Paused", "Press <b>Space</b> to resume or <b>Enter</b> to restart.");
      beep(220, 70, "square", 0.04);
      return;
    }
    if (state === "paused") {
      state = "running";
      hideOverlay();
      lastTickAt = performance.now();
      beep(330, 70, "square", 0.04);
    }
  }

  function gameOver(reason) {
    state = "gameover";
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      localStorage.setItem(STORAGE_KEY_BEST, String(best));
    }
    const reasonLine = reason ? `<div style="margin-top:6px;color:rgba(238,242,255,.62)">${escapeHtml(reason)}</div>` : "";
    showOverlay(
      "Game over",
      `Score: <b>${score}</b> • Best: <b>${best}</b>${reasonLine}<br/><br/>Press <b>Enter</b> to play again.`
    );
    beep(110, 140, "sawtooth", 0.06);
  }

  function placeFood() {
    const occupied = new Set([
      ...snake.map((p) => `${p.x},${p.y}`),
      ...obstacles.map((p) => `${p.x},${p.y}`),
    ]);
    for (let tries = 0; tries < 500; tries++) {
      const x = randInt(0, GRID - 1);
      const y = randInt(0, GRID - 1);
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
    // If the board is full, you basically win.
    gameOver("You filled the whole board.");
    return { x: 0, y: 0 };
  }

  function setDirection(dx, dy) {
    // Prevent 180-degree turns.
    if (dx === -dir.x && dy === -dir.y) return;
    nextDir = { x: dx, y: dy };
  }

  function tick() {
    dir = nextDir;
    const head = snake[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    // Wall collision
    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      gameOver("You hit the wall.");
      return;
    }

    // Obstacle collision
    if (obstacles.some((p) => p.x === next.x && p.y === next.y)) {
      gameOver("You hit an obstacle.");
      return;
    }

    // Self collision (allow moving into the last tail cell if we are not growing)
    const willEat = next.x === food.x && next.y === food.y;
    const tail = snake[snake.length - 1];
    const bodyToCheck = willEat ? snake : snake.slice(0, -1);
    if (bodyToCheck.some((p) => p.x === next.x && p.y === next.y)) {
      gameOver("You ran into yourself.");
      return;
    }

    snake.unshift(next);

    if (willEat) {
      score += 10;
      scoreEl.textContent = String(score);
      updateDifficulty();
      food = placeFood();
      beep(780, 45, "triangle", 0.05);
    } else {
      // Move forward: remove tail
      snake.pop();
    }
  }

  function draw() {
    // background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();
    drawObstacles();
    drawFood();
    drawSnake();

    if (state === "idle") {
      // subtle attract mode hint drawn on canvas too
      ctx.fillStyle = "rgba(238,242,255,.10)";
      ctx.font = "700 16px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Press Enter to start", canvas.width / 2, canvas.height / 2 + 210);
    }
  }

  function drawGrid() {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < GRID; i++) {
      const p = i * CELL;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, canvas.height);
      ctx.moveTo(0, p);
      ctx.lineTo(canvas.width, p);
    }
    ctx.stroke();
  }

  function drawObstacles() {
    ctx.fillStyle = COLORS.obstacle;
    obstacles.forEach((p) => {
      const x = p.x * CELL;
      const y = p.y * CELL;
      roundRect(ctx, x + 4, y + 4, CELL - 8, CELL - 8, 6);
      ctx.fill();
    });
  }

  function drawFood() {
    const x = food.x * CELL;
    const y = food.y * CELL;
    const r = CELL * 0.36;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;

    // glow
    ctx.fillStyle = COLORS.foodGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // core
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnake() {
    for (let i = snake.length - 1; i >= 0; i--) {
      const p = snake[i];
      const x = p.x * CELL;
      const y = p.y * CELL;
      const pad = i === 0 ? 2 : 3;

      ctx.fillStyle = i === 0 ? COLORS.snakeHead : COLORS.snakeBody;
      roundRect(ctx, x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7);
      ctx.fill();

      if (i === 0) drawEyes(p);
    }
  }

  function drawEyes(head) {
    const baseX = head.x * CELL;
    const baseY = head.y * CELL;
    const cx = baseX + CELL / 2;
    const cy = baseY + CELL / 2;

    // eye offsets depending on direction
    let ex1 = 0,
      ey1 = 0,
      ex2 = 0,
      ey2 = 0;

    if (dir.x === 1) {
      ex1 = 7;
      ey1 = -5;
      ex2 = 7;
      ey2 = 5;
    } else if (dir.x === -1) {
      ex1 = -7;
      ey1 = -5;
      ex2 = -7;
      ey2 = 5;
    } else if (dir.y === 1) {
      ex1 = -5;
      ey1 = 7;
      ex2 = 5;
      ey2 = 7;
    } else if (dir.y === -1) {
      ex1 = -5;
      ey1 = -7;
      ex2 = 5;
      ey2 = -7;
    }

    ctx.fillStyle = "rgba(11,16,32,.85)";
    ctx.beginPath();
    ctx.arc(cx + ex1, cy + ey1, 2.2, 0, Math.PI * 2);
    ctx.arc(cx + ex2, cy + ey2, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function loop(now) {
    requestAnimationFrame(loop);
    draw();

    if (state !== "running") return;

    if (now - lastTickAt >= tickMs) {
      // Catch up if tab was inactive
      const steps = Math.min(5, Math.floor((now - lastTickAt) / tickMs));
      for (let i = 0; i < steps; i++) tick();
      lastTickAt = now;
    }
  }

  function updateSoundBtn() {
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.textContent = `Sound: ${soundOn ? "On" : "Off"}`;
  }

  // Input
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "enter") {
      if (state === "running") {
        start();
        return;
      }
      start();
      return;
    }
    if (k === " " || k === "spacebar") {
      pauseToggle();
      return;
    }
    if (k === "arrowup" || k === "w") setDirection(0, -1);
    else if (k === "arrowdown" || k === "s") setDirection(0, 1);
    else if (k === "arrowleft" || k === "a") setDirection(-1, 0);
    else if (k === "arrowright" || k === "d") setDirection(1, 0);
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem(STORAGE_KEY_SOUND, soundOn ? "1" : "0");
    updateSoundBtn();
    beep(soundOn ? 600 : 180, 55, "square", 0.04);
  });

  // Init overlay
  showOverlay("Snake", "Press <b>Enter</b> to start.<br/><br/>Use <b>Arrow keys</b> or <b>WASD</b>.");
  state = "idle";
  resetGame();
  requestAnimationFrame(loop);

  // helpers
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function clampInt(v, min, max) {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function updateDifficulty() {
    // Every 40 points is a new level: 1, 2, 3, ...
    level = 1 + Math.floor(score / 40);
    level = clampInt(level, 1, 12);
    levelEl.textContent = String(level);

    // Medium curve: start at BASE_TICK_MS and decrease a bit each level.
    const step = Math.min(8, level - 1);
    tickMs = BASE_TICK_MS - step * 8; // 135, 127, 119, ...
    if (tickMs < 70) tickMs = 70; // don't get impossibly fast
  }

  function createObstacles() {
    const mid = Math.floor(GRID / 2);
    /** @type {{x:number,y:number}[]} */
    const result = [];

    // A plus-shaped set of blocks in the middle of the board
    for (let x = mid - 3; x <= mid + 3; x++) {
      result.push({ x, y: mid });
    }
    for (let y = mid - 3; y <= mid + 3; y++) {
      if (y === mid) continue;
      result.push({ x: mid, y });
    }

    return result;
  }
})();
