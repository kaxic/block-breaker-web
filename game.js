"use strict";

const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");
const stagePicker = document.querySelector("#stage-picker");
const stageOptions = document.querySelector("#stage-options");

const WINDOW = { width: 780, height: 620 };
const FIELD = { minX: 10, minY: 10, maxX: 490, maxY: 610, blockW: 40, blockH: 20, cols: 12, rows: 30 };
const LIFE_SET = 5;
const STAGE_NUM = 16;
const START_BUTTON = { x: (WINDOW.width - 359) / 2, y: 400, width: 359, height: 70 };

const TYPE = {
  EMPTY: 0, NORMAL1: 1, NORMAL2: 2, NORMAL3: 3, NORMAL4: 4, NORMAL5: 5, NORMAL6: 6,
  HARD1: 7, BOMB: 8, LIFE: 9, V_HARD: 10, SCORE: 11, EXTEND: 12, SHRINK: 13,
  CLEAR: 14, HARD2: 15
};

const imageFiles = [
  "title.png", "gamestart.png", "back.png", "game.png", "block1.png", "block2.png", "block3.png",
  "block4.png", "block5.png", "block6.png", "Hblock1.png", "Hblock2.png", "bomb.png", "1up.png",
  "VHblock.png", "score.png", "extend.png", "shrink.png", "C.png", "player.png", "Ready.png",
  "start.png", "pause.png", "clear.png", "allclear.png"
];
const soundFiles = ["bound.wav", "delete.wav", "Hblock.mp3", "爆発.wav", "1up.mp3", "score.wav", "change.mp3", "victory.mp3"];

const images = {};
const sounds = {};
let stageLayouts = [];
let selectedStartStage = 1;
let stageButtons = [];
let state;
let lastTime = performance.now();
let accumulator = 0;
let audioUnlocked = false;

function loadImage(filename) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([filename, image]);
    image.onerror = () => reject(new Error(`画像を読み込めません: ${filename}`));
    image.src = `assets/images/${filename}`;
  });
}

function loadSound(filename) {
  const sound = new Audio(`assets/sounds/${filename}`);
  sound.preload = "auto";
  return [filename, sound];
}

function playSound(filename) {
  if (!audioUnlocked || !sounds[filename]) return;
  const sound = sounds[filename].cloneNode();
  sound.play().catch(() => {});
}

async function loadStages() {
  const files = Array.from({ length: STAGE_NUM }, (_, index) => index + 1);
  return Promise.all(files.map(async number => {
    const response = await fetch(`assets/stages/block${number}.csv`);
    if (!response.ok) throw new Error(`ステージ ${number} を読み込めません`);
    const text = (await response.text()).replace(/^\uFEFF/, "").trim();
    return text.split(/\r?\n/).filter(Boolean).map(row => row.split(",").map(value => Number(value.trim())));
  }));
}

function createState() {
  return {
    mode: "title", stage: 1, life: LIFE_SET, score: 0,
    highscore: Number(localStorage.getItem("block-breaker-web-highscore") || 0),
    paddle: { x: 320, y: 500, width: 40, height: 15 },
    ball: { x: 150, y: 400, radius: 5, vx: Math.cos(Math.PI / 4) * 5, vy: Math.sin(Math.PI / 4) * 5 },
    blocks: [], readyFrames: 0, clearFrames: 0, effects: []
  };
}

function resetBall() {
  state.ball.x = 150;
  state.ball.y = 400;
  state.ball.vx = Math.cos(Math.PI / 4) * 5;
  state.ball.vy = Math.sin(Math.PI / 4) * 5;
}

function updateHighscore() {
  if (state.score > state.highscore) {
    state.highscore = state.score;
    localStorage.setItem("block-breaker-web-highscore", String(state.highscore));
  }
}

function resetGame() {
  const highscore = state ? state.highscore : Number(localStorage.getItem("block-breaker-web-highscore") || 0);
  state = createState();
  state.highscore = highscore;
  setStage(selectedStartStage);
  state.mode = "title";
  canvas.style.cursor = "pointer";
  stagePicker.hidden = false;
  stagePicker.disabled = false;
}

function createStagePicker() {
  stageButtons = Array.from({ length: STAGE_NUM }, (_, index) => {
    const number = index + 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-button";
    button.textContent = String(number);
    button.setAttribute("aria-label", `ステージ ${number}`);
    button.setAttribute("aria-pressed", String(number === selectedStartStage));
    button.addEventListener("click", () => selectStartStage(number));
    return button;
  });
  stageOptions.replaceChildren(...stageButtons);
}

function selectStartStage(number) {
  if (state?.mode !== "title" || !Number.isInteger(number) || number < 1 || number > STAGE_NUM) return;
  selectedStartStage = number;
  stageButtons.forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index + 1 === number));
  });
}

function setStage(number) {
  state.stage = number;
  state.blocks = stageLayouts[number - 1].map((row, y) => row.map((type, x) => ({ x, y, type, live: type !== TYPE.EMPTY })));
}

function beginGame() {
  // 最初のクリックを音声再生の許可操作として使う。
  audioUnlocked = true;
  state.mode = "game";
  state.life = LIFE_SET;
  state.score = 0;
  setStage(selectedStartStage);
  state.paddle.x = 320;
  state.paddle.width = 40;
  resetBall();
  state.readyFrames = 120;
  state.clearFrames = 0;
  state.effects = [];
  canvas.style.cursor = "none";
  stagePicker.hidden = true;
  stagePicker.disabled = true;
}

function getBlockAt(pointX, pointY) {
  const column = Math.floor((pointX - FIELD.minX) / FIELD.blockW);
  const row = Math.floor((pointY - FIELD.minY) / FIELD.blockH);
  if (column < 0 || row < 0 || column >= FIELD.cols || row >= FIELD.rows) return null;
  return state.blocks[row]?.[column] || null;
}

function addEffect(x, y) {
  for (let index = 0; index < 8; index++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2;
    state.effects.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 22 });
  }
}

function explode(block) {
  for (let y = block.y - 1; y <= block.y + 1; y++) {
    for (let x = block.x - 1; x <= block.x + 1; x++) {
      if (x < 0 || y < 0 || x >= FIELD.cols || y >= FIELD.rows) continue;
      destroyBlock(state.blocks[y][x], true);
    }
  }
}

function destroyBlock(block, fromExplosion = false) {
  if (!block || !block.live) return false;
  const centerX = FIELD.minX + (block.x + .5) * FIELD.blockW;
  const centerY = FIELD.minY + (block.y + .5) * FIELD.blockH;

  switch (block.type) {
    case TYPE.NORMAL1:
    case TYPE.NORMAL2:
    case TYPE.NORMAL3:
    case TYPE.NORMAL4:
    case TYPE.NORMAL5:
    case TYPE.NORMAL6:
    case TYPE.HARD2:
      block.live = false;
      state.score += 100;
      addEffect(centerX, centerY);
      playSound("delete.wav");
      break;
    case TYPE.HARD1:
      if (fromExplosion) {
        block.live = false;
        state.score += 100;
        addEffect(centerX, centerY);
        playSound("delete.wav");
      } else {
        block.type = TYPE.HARD2;
        playSound("Hblock.mp3");
      }
      break;
    case TYPE.BOMB:
      block.live = false;
      addEffect(centerX, centerY);
      playSound("爆発.wav");
      explode(block);
      break;
    case TYPE.LIFE:
      block.live = false;
      state.life++;
      addEffect(centerX, centerY);
      playSound("1up.mp3");
      break;
    case TYPE.V_HARD:
      return true;
    case TYPE.SCORE:
      block.live = false;
      state.score += 1000;
      addEffect(centerX, centerY);
      playSound("score.wav");
      break;
    case TYPE.EXTEND:
      block.live = false;
      state.paddle.width = 55;
      addEffect(centerX, centerY);
      playSound("change.mp3");
      break;
    case TYPE.SHRINK:
      block.live = false;
      state.paddle.width = 25;
      addEffect(centerX, centerY);
      playSound("change.mp3");
      break;
    case TYPE.CLEAR:
      block.live = false;
      startClear();
      break;
    default:
      return false;
  }
  updateHighscore();
  return true;
}

function hitBlockAt(pointX, pointY) { return destroyBlock(getBlockAt(pointX, pointY)); }

function hasClearedRequiredBlocks() {
  return !state.blocks.flat().some(block => block.live && (block.type < TYPE.LIFE || block.type === TYPE.HARD2));
}

function startClear() {
  if (state.clearFrames > 0) return;
  state.clearFrames = 400;
  updateHighscore();
  playSound("victory.mp3");
}

function reflect(normalX, normalY) {
  const ball = state.ball;
  const normalLength = Math.hypot(normalX, normalY);
  if (normalLength === 0) return;

  // DxLib版の Ball::Reflect と同じく、1フレーム前へ戻してから法線反射する。
  ball.x -= ball.vx;
  ball.y -= ball.vy;
  const nx = normalX / normalLength;
  const ny = normalY / normalLength;
  const projection = ball.vx * nx + ball.vy * ny;
  ball.vx -= 2 * projection * nx;
  ball.vy -= 2 * projection * ny;
  ball.x += ball.vx;
  ball.y += ball.vy;
  playSound("bound.wav");
}

function reflectX() { reflect(1, 0); }
function reflectY() { reflect(0, 1); }

function moveBall() {
  const ball = state.ball;
  const paddle = state.paddle;
  const left = ball.x - ball.radius;
  const right = ball.x + ball.radius;
  const top = ball.y - ball.radius;
  const bottom = ball.y + ball.radius;

  if (left < FIELD.minX || right > FIELD.maxX) reflectX();
  if (top < FIELD.minY) reflectY();

  const paddleTop = paddle.y - paddle.height;
  if (ball.x >= paddle.x - paddle.width && ball.x <= paddle.x + paddle.width && bottom > paddleTop && bottom <= paddleTop + ball.vy) {
    // 元版は当たった位置を角度へ直線変換せず、バー中心と画面下端を結ぶ点を基準に反射する。
    reflect(ball.x - paddle.x, ball.y - FIELD.maxY);
    ball.y = paddleTop - ball.radius;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (-ball.vy / speed < Math.sin(40 * Math.PI / 180)) {
      ball.vx = (ball.vx < 0 ? -1 : 1) * speed * Math.cos(40 * Math.PI / 180);
      ball.vy = -speed * Math.sin(40 * Math.PI / 180);
    }
  }

  ball.x += ball.vx;
  ball.y += ball.vy;
}

function updateEffects() {
  state.effects.forEach(effect => {
    effect.x += effect.vx;
    effect.y += effect.vy;
    effect.vy += .07;
    effect.life--;
  });
  state.effects = state.effects.filter(effect => effect.life > 0);
}

function updateGameFrame() {
  updateEffects();
  if (state.clearFrames > 0) {
    state.clearFrames--;
    if (state.clearFrames === 0) {
      if (state.stage === STAGE_NUM) {
        updateHighscore();
        state.mode = "allclear";
        canvas.style.cursor = "pointer";
      } else {
        setStage(state.stage + 1);
        state.paddle.width = 40;
        resetBall();
        state.readyFrames = 120;
      }
    }
    return;
  }
  if (state.readyFrames > 0) {
    state.readyFrames--;
    return;
  }
  if (hitBlockAt(state.ball.x + state.ball.radius, state.ball.y) || hitBlockAt(state.ball.x - state.ball.radius, state.ball.y)) reflectX();
  if (hitBlockAt(state.ball.x, state.ball.y + state.ball.radius) || hitBlockAt(state.ball.x, state.ball.y - state.ball.radius)) reflectY();
  if (hasClearedRequiredBlocks()) {
    startClear();
    return;
  }
  moveBall();
  if (state.ball.y + state.ball.radius >= FIELD.maxY) {
    playSound("爆発.wav");
    state.life--;
    if (state.life <= 0) {
      updateHighscore();
      resetGame();
    } else {
      state.paddle.width = 40;
      resetBall();
      state.readyFrames = 120;
    }
  }
}

function drawBlock(block) {
  if (!block.live) return;
  const filename = {
    [TYPE.NORMAL1]: "block1.png", [TYPE.NORMAL2]: "block2.png", [TYPE.NORMAL3]: "block3.png",
    [TYPE.NORMAL4]: "block4.png", [TYPE.NORMAL5]: "block5.png", [TYPE.NORMAL6]: "block6.png",
    [TYPE.HARD1]: "Hblock1.png", [TYPE.HARD2]: "Hblock2.png", [TYPE.BOMB]: "bomb.png",
    [TYPE.LIFE]: "1up.png", [TYPE.V_HARD]: "VHblock.png", [TYPE.SCORE]: "score.png",
    [TYPE.EXTEND]: "extend.png", [TYPE.SHRINK]: "shrink.png", [TYPE.CLEAR]: "C.png"
  }[block.type];
  if (filename) ctx.drawImage(images[filename], FIELD.minX + block.x * FIELD.blockW, FIELD.minY + block.y * FIELD.blockH, FIELD.blockW, FIELD.blockH);
}

function drawHudText(top, label, value) {
  const left = FIELD.maxX + 20;
  const right = WINDOW.width - 18;
  const height = 80;
  const padding = 16;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "rgba(12, 35, 46, .94)";
  ctx.fillRect(left, top, right - left, height);
  ctx.fillStyle = "#62d4ed";
  ctx.fillRect(left, top, 3, height);
  ctx.strokeStyle = "rgba(255, 255, 255, .24)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left + .5, top + .5, right - left - 1, height - 1);

  ctx.fillStyle = "#b9e7f0";
  ctx.font = "700 32px 'Segoe UI', 'Yu Gothic', Meiryo, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, left + padding, top + 31);

  ctx.font = "700 40px 'Segoe UI', 'Yu Gothic', Meiryo, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#f5fcff";
  ctx.fillText(value, right - padding, top + 68);
}

function drawHud() {
  ctx.save();
  drawHudText(40, "STAGE", String(state.stage));
  drawHudText(132, "LIFE", String(state.life));
  drawHudText(224, "HIGHSCORE", state.highscore.toLocaleString("en-US"));
  drawHudText(316, "SCORE", state.score.toLocaleString("en-US"));
  ctx.restore();
}

function drawGameScreen() {
  ctx.drawImage(images["back.png"], 0, 0, WINDOW.width, WINDOW.height);
  ctx.drawImage(images["game.png"], FIELD.minX, FIELD.minY, 480, 600);
  state.blocks.flat().forEach(drawBlock);
  const paddle = state.paddle;
  ctx.drawImage(images["player.png"], paddle.x - paddle.width, paddle.y - paddle.height, paddle.width * 2, paddle.height * 2);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff27c";
  state.effects.forEach(effect => {
    ctx.globalAlpha = Math.max(0, effect.life / 22);
    ctx.fillRect(effect.x - 2, effect.y - 2, 4, 4);
  });
  ctx.globalAlpha = 1;
  drawHud();
  if (state.clearFrames > 0) {
    const image = images["clear.png"];
    ctx.drawImage(image, (FIELD.maxX + FIELD.minX - image.width) / 2, (FIELD.maxY + FIELD.minY - image.height) / 2);
  } else if (state.readyFrames > 0) {
    const image = state.readyFrames > 30 ? images["Ready.png"] : images["start.png"];
    ctx.drawImage(image, (FIELD.maxX + FIELD.minX - image.width) / 2, (FIELD.maxY + FIELD.minY - image.height) / 2);
  }
}

function draw() {
  ctx.clearRect(0, 0, WINDOW.width, WINDOW.height);
  if (state.mode === "title") {
    ctx.drawImage(images["title.png"], 0, 0, WINDOW.width, WINDOW.height);
    ctx.drawImage(images["gamestart.png"], START_BUTTON.x, START_BUTTON.y);
  } else if (state.mode === "pause") {
    ctx.drawImage(images["pause.png"], 0, 0, WINDOW.width, WINDOW.height);
  } else if (state.mode === "allclear") {
    ctx.drawImage(images["allclear.png"], 0, 0, WINDOW.width, WINDOW.height);
  } else {
    drawGameScreen();
  }
}

function tick(now) {
  const elapsed = Math.min(.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += elapsed;
  while (accumulator >= 1 / 60) {
    if (state.mode === "game") updateGameFrame();
    accumulator -= 1 / 60;
  }
  draw();
  requestAnimationFrame(tick);
}

function toCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * WINDOW.width / rect.width, y: (event.clientY - rect.top) * WINDOW.height / rect.height };
}

canvas.addEventListener("pointermove", event => {
  if (!state || state.mode !== "game") return;
  const point = toCanvasPoint(event);
  state.paddle.x = Math.max(FIELD.minX + state.paddle.width, Math.min(FIELD.maxX - state.paddle.width, point.x));
});

canvas.addEventListener("pointerdown", event => {
  if (!state) return;
  const point = toCanvasPoint(event);
  if (event.button !== 0) return;
  if (state.mode === "title") {
    if (point.x >= START_BUTTON.x && point.x <= START_BUTTON.x + START_BUTTON.width && point.y >= START_BUTTON.y && point.y <= START_BUTTON.y + START_BUTTON.height) beginGame();
  } else if (state.mode === "pause") {
    state.mode = "game";
    state.readyFrames = 120;
    canvas.style.cursor = "none";
  } else if (state.mode === "allclear") {
    resetGame();
  }
});

canvas.addEventListener("contextmenu", event => {
  event.preventDefault();
  if (state?.mode === "game") {
    state.mode = "pause";
    canvas.style.cursor = "pointer";
  }
});

Promise.all(imageFiles.map(loadImage)).then(imageEntries => {
  imageEntries.forEach(([name, image]) => { images[name] = image; });
  soundFiles.map(loadSound).forEach(([name, sound]) => { sounds[name] = sound; });
  return loadStages();
}).then(layouts => {
  stageLayouts = layouts;
  createStagePicker();
  resetGame();
  requestAnimationFrame(tick);
}).catch(error => {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, WINDOW.width, WINDOW.height);
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.fillText(error.message, 32, 60);
  console.error(error);
});
