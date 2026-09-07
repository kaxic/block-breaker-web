"use strict";

const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");
const ui = {
  stage: document.querySelector("#stage-value"), life: document.querySelector("#life-value"),
  score: document.querySelector("#score-value"), best: document.querySelector("#best-value"),
  overlay: document.querySelector("#message-overlay"), kicker: document.querySelector("#message-kicker"),
  title: document.querySelector("#message-title"), text: document.querySelector("#message-text"),
  start: document.querySelector("#start-button"), restart: document.querySelector("#restart-button"),
  sound: document.querySelector("#sound-button")
};

const W = canvas.width, H = canvas.height;
const field = { x: 42, y: 40, w: 650, h: 560, cols: 12, rows: 16 };
field.cellW = field.w / field.cols;
field.cellH = 23;
const TYPES = { EMPTY: 0, NORMAL: 1, HARD: 7, BOMB: 8, LIFE: 9, STEEL: 10, SCORE: 11, WIDE: 12, NARROW: 13, CLEAR: 14 };
const COLORS = ["", "#f5576c", "#ff8a55", "#f9cb4f", "#70db7a", "#3cc6dd", "#8579ff"];

let state, input, audio, lastTime;

function freshState() {
  return {
    mode: "title", stage: 1, lives: 5, score: 0, best: Number(localStorage.getItem("block-breaker-web-best") || 0),
    paddle: { x: field.x + field.w / 2, y: field.y + field.h - 32, half: 57, h: 13, target: field.x + field.w / 2 },
    ball: { x: 0, y: 0, r: 7, vx: 0, vy: 0, speed: 390 }, blocks: [], particles: [], timer: 0,
    notice: "", sound: true
  };
}

function showMessage(kicker, title, text) {
  ui.kicker.textContent = kicker;
  ui.title.textContent = title;
  ui.text.textContent = text;
  ui.overlay.classList.remove("hidden");
}

function hideMessage() { ui.overlay.classList.add("hidden"); }

function updateUi() {
  ui.stage.textContent = `${state.stage} / 16`;
  ui.life.textContent = state.lives;
  ui.score.textContent = state.score.toLocaleString("ja-JP");
  ui.best.textContent = state.best.toLocaleString("ja-JP");
}

function stageKind(stage, row, col) {
  const normal = ((stage + row * 2 + col) % 6) + 1;
  if (stage >= 5 && (row + col * 2 + stage) % 19 === 0) return TYPES.HARD;
  return normal;
}

function createStage(stage) {
  const blocks = [];
  const activeRows = Math.min(5 + Math.ceil(stage / 2), 13);
  const center = (field.cols - 1) / 2;
  for (let row = 0; row < activeRows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const distance = Math.abs(col - center);
      const gap = (stage % 4 === 0 && row === 1 && (col === 0 || col === field.cols - 1)) ||
        (stage >= 9 && row % 4 === 3 && distance > 3);
      if (gap) continue;
      blocks.push(makeBlock(col, row, stageKind(stage, row, col)));
    }
  }
  const replace = (col, row, type) => {
    const old = blocks.find(b => b.col === col && b.row === row);
    if (old) { old.type = type; old.hp = type === TYPES.HARD ? 2 : 1; }
  };
  if (stage >= 2) replace(5, 1, TYPES.BOMB);
  if (stage >= 3) replace(2, Math.min(3, activeRows - 1), TYPES.HARD);
  if (stage >= 4) replace(9, Math.min(4, activeRows - 1), TYPES.STEEL);
  if (stage >= 5) replace(1, 1, TYPES.LIFE);
  if (stage >= 6) replace(10, 2, TYPES.SCORE);
  if (stage >= 7) replace(3, 0, TYPES.WIDE);
  if (stage >= 8) replace(8, 0, TYPES.NARROW);
  if (stage % 4 === 0) replace(5, activeRows - 1, TYPES.CLEAR);
  if (stage === 16) {
    for (let col = 0; col < field.cols; col++) if (col !== 5 && col !== 6) replace(col, 0, TYPES.HARD);
    replace(5, 0, TYPES.CLEAR); replace(6, 0, TYPES.BOMB);
  }
  return blocks;
}

function makeBlock(col, row, type) {
  return { col, row, type, hp: type === TYPES.HARD ? 2 : 1, alive: true, flash: 0 };
}

function resetBall() {
  const p = state.paddle;
  const b = state.ball;
  b.x = p.x; b.y = p.y - p.h - b.r - 2;
  b.speed = 385 + Math.min(state.stage * 9, 130);
  b.vx = 0; b.vy = 0;
}

function resetGame() {
  state = freshState();
  state.blocks = createStage(1);
  resetBall();
  showMessage("16 STAGES", "ブロック崩し", "マウスまたは矢印キーでバーを動かそう");
  ui.start.textContent = "ゲームを始める";
  updateUi();
}

function prepareStage() {
  state.blocks = createStage(state.stage);
  state.particles = [];
  state.mode = "ready";
  state.timer = 1.15;
  state.paddle.half = 57;
  resetBall();
  hideMessage();
  ui.start.textContent = "一時停止";
  updateUi();
}

function startOrPause() {
  ensureAudio();
  if (state.mode === "title" || state.mode === "gameover" || state.mode === "allclear") {
    state.stage = 1; state.lives = 5; state.score = 0; prepareStage(); return;
  }
  if (state.mode === "ready") { launch(); return; }
  if (state.mode === "playing") { state.mode = "paused"; showMessage("PAUSE", "一時停止", "Space またはボタンで再開"); ui.start.textContent = "再開"; return; }
  if (state.mode === "paused") { state.mode = "playing"; hideMessage(); ui.start.textContent = "一時停止"; }
}

function launch() {
  const b = state.ball;
  const angle = -Math.PI / 2 - .34;
  b.vx = Math.cos(angle) * b.speed;
  b.vy = Math.sin(angle) * b.speed;
  state.mode = "playing";
  hideMessage();
  ui.start.textContent = "一時停止";
  sound("launch");
}

function setBest() {
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("block-breaker-web-best", String(state.best));
  }
}

function blockRect(block) { return { x: field.x + block.col * field.cellW + 3, y: field.y + block.row * field.cellH + 3, w: field.cellW - 6, h: field.cellH - 6 }; }

function isBreakable(block) { return block.alive && block.type !== TYPES.STEEL; }

function remainingBlocks() { return state.blocks.some(isBreakable); }

function burst(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, s = 35 + Math.random() * 150;
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .35 + Math.random() * .35, max: .7, color });
  }
}

function destroyBlock(block, fromExplosion = false) {
  if (!block || !block.alive || block.type === TYPES.STEEL) return;
  const rect = blockRect(block);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  if (block.type === TYPES.HARD && block.hp === 2 && !fromExplosion) {
    block.hp = 1; block.flash = .25; sound("hard"); return;
  }
  block.alive = false;
  let color = COLORS[block.type] || "#e6f0ff";
  if (block.type >= 1 && block.type <= 6 || block.type === TYPES.HARD) state.score += 100;
  if (block.type === TYPES.SCORE) { state.score += 1000; color = "#ffe06b"; sound("score"); }
  else if (block.type === TYPES.LIFE) { state.lives++; color = "#64f29a"; sound("life"); }
  else if (block.type === TYPES.WIDE) { state.paddle.half = 78; color = "#878dff"; sound("power"); }
  else if (block.type === TYPES.NARROW) { state.paddle.half = 37; color = "#dc7aff"; sound("power"); }
  else if (block.type === TYPES.CLEAR) { color = "#eff9ff"; sound("clear"); burst(cx, cy, color, 32); clearStage(true); return; }
  else if (block.type === TYPES.BOMB) { color = "#ff725f"; sound("bomb"); }
  else sound("hit");
  burst(cx, cy, color, block.type === TYPES.BOMB ? 24 : 9);
  if (block.type === TYPES.BOMB) {
    for (const target of state.blocks) {
      if (target !== block && Math.abs(target.col - block.col) <= 1 && Math.abs(target.row - block.row) <= 1) destroyBlock(target, true);
    }
  }
  setBest(); updateUi();
  if (!remainingBlocks()) clearStage(false);
}

function clearStage(allClear) {
  if (state.mode !== "playing") return;
  state.mode = "stageclear";
  state.timer = 1.25;
  state.notice = allClear ? "全消去！" : "ステージクリア！";
  sound("stage");
}

function loseLife() {
  state.lives--;
  setBest(); updateUi();
  if (state.lives <= 0) {
    state.mode = "gameover";
    showMessage("GAME OVER", "ゲームオーバー", `スコア ${state.score.toLocaleString("ja-JP")}　Spaceで再挑戦`);
    ui.start.textContent = "もう一度遊ぶ";
    sound("lose");
    return;
  }
  state.mode = "ready";
  state.timer = 1.0;
  resetBall();
  sound("lose");
}

function hitBlock(block) {
  if (block.type === TYPES.STEEL) { block.flash = .15; sound("hard"); return; }
  destroyBlock(block);
}

function circleRectCollision(ball, rect) {
  const nx = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  const dx = ball.x - nx, dy = ball.y - ny;
  return dx * dx + dy * dy <= ball.r * ball.r;
}

function reflectFromBlock(block) {
  const rect = blockRect(block), b = state.ball;
  const prevX = b.x - b.vx * .016, prevY = b.y - b.vy * .016;
  const crossedHorizontal = prevY + b.r <= rect.y || prevY - b.r >= rect.y + rect.h;
  if (crossedHorizontal) b.vy *= -1;
  else b.vx *= -1;
}

function movePaddle(dt) {
  const p = state.paddle;
  if (input.left) p.target -= 610 * dt;
  if (input.right) p.target += 610 * dt;
  const min = field.x + p.half, max = field.x + field.w - p.half;
  p.target = Math.max(min, Math.min(max, p.target));
  p.x += (p.target - p.x) * Math.min(1, dt * 17);
  if (state.mode === "ready") resetBall();
}

function moveBall(dt) {
  const b = state.ball, p = state.paddle;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x - b.r < field.x) { b.x = field.x + b.r; b.vx = Math.abs(b.vx); sound("wall"); }
  if (b.x + b.r > field.x + field.w) { b.x = field.x + field.w - b.r; b.vx = -Math.abs(b.vx); sound("wall"); }
  if (b.y - b.r < field.y) { b.y = field.y + b.r; b.vy = Math.abs(b.vy); sound("wall"); }
  const paddleRect = { x: p.x - p.half, y: p.y - p.h / 2, w: p.half * 2, h: p.h };
  if (b.vy > 0 && circleRectCollision(b, paddleRect)) {
    b.y = paddleRect.y - b.r - .5;
    const hit = Math.max(-1, Math.min(1, (b.x - p.x) / p.half));
    const angle = -Math.PI / 2 + hit * (Math.PI / 2.25);
    b.speed = Math.min(590, b.speed + 3.5);
    b.vx = Math.cos(angle) * b.speed;
    b.vy = Math.sin(angle) * b.speed;
    sound("paddle");
  }
  for (const block of state.blocks) {
    if (!block.alive) continue;
    const rect = blockRect(block);
    if (circleRectCollision(b, rect)) {
      reflectFromBlock(block);
      hitBlock(block);
      break;
    }
  }
  if (b.y - b.r > field.y + field.h) loseLife();
}

function update(dt) {
  movePaddle(dt);
  for (const particle of state.particles) { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 180 * dt; particle.life -= dt; }
  state.particles = state.particles.filter(p => p.life > 0);
  for (const block of state.blocks) block.flash = Math.max(0, block.flash - dt);
  if (state.mode === "ready") {
    state.timer -= dt;
    if (state.timer <= 0) launch();
  } else if (state.mode === "playing") {
    moveBall(dt);
  } else if (state.mode === "stageclear") {
    state.timer -= dt;
    if (state.timer <= 0) {
      if (state.stage === 16) {
        state.mode = "allclear";
        setBest(); updateUi();
        showMessage("CONGRATULATIONS", "ALL CLEAR!", `最終スコア ${state.score.toLocaleString("ja-JP")}　Spaceで最初から`);
        ui.start.textContent = "もう一度遊ぶ";
      } else {
        state.stage++;
        prepareStage();
      }
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#081b3b"); gradient.addColorStop(1, "#06111e");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .22; ctx.strokeStyle = "#4b8ec3"; ctx.lineWidth = 1;
  for (let x = field.x; x <= field.x + field.w; x += field.cellW) { ctx.beginPath(); ctx.moveTo(x, field.y); ctx.lineTo(x, field.y + field.h); ctx.stroke(); }
  for (let y = field.y; y <= field.y + field.h; y += field.cellH) { ctx.beginPath(); ctx.moveTo(field.x, y); ctx.lineTo(field.x + field.w, y); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = "#7ed6ff"; ctx.lineWidth = 2; ctx.strokeRect(field.x, field.y, field.w, field.h);
}

function drawBlock(block) {
  if (!block.alive) return;
  const r = blockRect(block), type = block.type;
  let color = COLORS[type] || "#c3d2eb";
  if (type === TYPES.HARD) color = block.hp === 2 ? "#c9d4e6" : "#8196b3";
  if (type === TYPES.BOMB) color = "#e9544e";
  if (type === TYPES.LIFE) color = "#45d77b";
  if (type === TYPES.STEEL) color = "#5e718d";
  if (type === TYPES.SCORE) color = "#f3bc45";
  if (type === TYPES.WIDE) color = "#777de8";
  if (type === TYPES.NARROW) color = "#c45dde";
  if (type === TYPES.CLEAR) color = "#e9f8ff";
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = block.flash > 0 ? 18 : 5;
  ctx.fillStyle = color; roundRect(r.x, r.y, r.w, r.h, 5);
  ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.25)"; roundRect(r.x + 2, r.y + 2, r.w - 4, 4, 2);
  ctx.fillStyle = type === TYPES.CLEAR ? "#193557" : "rgba(5,17,37,.75)";
  ctx.font = "800 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const label = type === TYPES.BOMB ? "●" : type === TYPES.LIFE ? "+1" : type === TYPES.STEEL ? "◆" : type === TYPES.SCORE ? "+" : type === TYPES.WIDE ? "↔" : type === TYPES.NARROW ? "↕" : type === TYPES.CLEAR ? "★" : type === TYPES.HARD ? (block.hp === 2 ? "Ⅱ" : "Ⅰ") : "";
  if (label) ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + .5);
  ctx.restore();
}

function drawGame() {
  drawBackground();
  for (const block of state.blocks) drawBlock(block);
  const p = state.paddle, b = state.ball;
  ctx.save(); ctx.shadowColor = "#5be4ff"; ctx.shadowBlur = 16; ctx.fillStyle = "#73dfff"; roundRect(p.x - p.half, p.y - p.h / 2, p.half * 2, p.h, 7); ctx.restore();
  ctx.save(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 13; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  for (const particle of state.particles) { ctx.save(); ctx.globalAlpha = Math.max(0, particle.life / particle.max); ctx.fillStyle = particle.color; ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4); ctx.restore(); }
  if (state.mode === "stageclear") {
    ctx.save(); ctx.fillStyle = "rgba(0,11,29,.66)"; ctx.fillRect(field.x, field.y, field.w, field.h); ctx.fillStyle = "#eaf7ff"; ctx.textAlign = "center"; ctx.font = "800 38px system-ui, sans-serif"; ctx.fillText(state.notice, field.x + field.w / 2, field.y + field.h / 2); ctx.restore();
  }
  ctx.save(); ctx.fillStyle = "#90a8c7"; ctx.font = "700 15px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillText("BLOCKS", 745, 90); ctx.fillStyle = "#ffffff"; ctx.font = "800 34px system-ui, sans-serif"; ctx.fillText(String(state.blocks.filter(isBreakable).length), 745, 128); ctx.fillStyle = "#94a7c3"; ctx.font = "600 15px system-ui, sans-serif"; ctx.fillText("壊せないブロック", 745, 188); ctx.fillStyle = "#e9f3ff"; ctx.font = "800 26px system-ui, sans-serif"; ctx.fillText(String(state.blocks.filter(b => b.alive && b.type === TYPES.STEEL).length), 745, 218); ctx.restore();
}

function frame(now) {
  const dt = Math.min(.035, (now - lastTime) / 1000 || 0);
  lastTime = now;
  update(dt); drawGame();
  requestAnimationFrame(frame);
}

function ensureAudio() {
  if (!state.sound) return;
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
}

function sound(kind) {
  if (!state.sound || !audio || audio.state !== "running") return;
  const sounds = { launch: [420, .08, "sine"], hit: [250, .035, "square"], hard: [120, .05, "square"], wall: [180, .025, "sine"], paddle: [320, .045, "triangle"], bomb: [85, .16, "sawtooth"], life: [740, .14, "sine"], score: [900, .1, "triangle"], power: [510, .1, "sine"], clear: [640, .18, "sine"], stage: [780, .16, "triangle"], lose: [90, .18, "sawtooth"] };
  const [frequency, length, wave] = sounds[kind] || sounds.hit;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = wave; oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(.045, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + length);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + length);
}

function setPointer(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * W / rect.width;
  state.paddle.target = x;
}

input = { left: false, right: false };
canvas.addEventListener("pointermove", event => setPointer(event.clientX));
canvas.addEventListener("pointerdown", event => { setPointer(event.clientX); if (state.mode === "title" || state.mode === "ready") startOrPause(); });
document.addEventListener("keydown", event => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "ArrowLeft") input.left = true;
  if (event.code === "ArrowRight") input.right = true;
  if (event.code === "Space" && !event.repeat) startOrPause();
  if (event.code === "KeyR" && !event.repeat) resetGame();
});
document.addEventListener("keyup", event => { if (event.code === "ArrowLeft") input.left = false; if (event.code === "ArrowRight") input.right = false; });
ui.start.addEventListener("click", startOrPause);
ui.restart.addEventListener("click", resetGame);
ui.sound.addEventListener("click", () => { state.sound = !state.sound; ui.sound.setAttribute("aria-pressed", String(state.sound)); ui.sound.textContent = state.sound ? "♪" : "×"; if (state.sound) ensureAudio(); });

resetGame();
lastTime = performance.now();
requestAnimationFrame(frame);

