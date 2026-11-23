"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "game.js"), "utf8");

class Element {
  constructor() {
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  replaceChildren(...children) { this.children = children; }
  emit(name, event = {}) {
    for (const listener of this.listeners[name] || []) listener(event);
  }
}

function csv(number) {
  return fs.readFileSync(path.join(root, "assets", "stages", `block${number}.csv`), "utf8")
    .replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean)
    .map(row => row.split(",").map(value => Number(value.trim())));
}

function expectedBlocks(number) {
  return csv(number).map((row, y) => row.map((type, x) => ({ x, y, type, live: type !== 0 })));
}

function fixture() {
  const canvas = new Element();
  const picker = new Element();
  picker.hidden = true;
  picker.disabled = true;
  const options = new Element();
  const elements = { "#game-canvas": canvas, "#stage-picker": picker, "#stage-options": options };
  const pendingImages = [];
  const storage = new Map();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  canvas.getContext = () => ({ fillRect() {}, fillText() {} });
  // Deliberately use a half-size canvas offset from the viewport origin.
  canvas.getBoundingClientRect = () => ({ left: 40, top: 20, width: 390, height: 310 });
  class Image {
    set src(value) { this.url = value; pendingImages.push(this); }
  }
  class Audio {
    constructor(url) { this.url = url; }
    cloneNode() { return new Audio(this.url); }
    play() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    document: {
      querySelector: selector => elements[selector],
      createElement: () => new Element()
    },
    Image,
    Audio,
    performance: { now: () => 0 },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    fetch: async url => {
      assert.match(url, /^assets\/stages\/block(?:[1-9]|1[0-6])\.csv$/);
      return { ok: true, text: async () => fs.readFileSync(path.join(root, url), "utf8") };
    },
    requestAnimationFrame: () => { resolveReady(); return 1; },
    console: { error: error => rejectReady(error) }
  });
  vm.runInContext(source, context, { filename: "game.js" });
  const evaluate = code => vm.runInContext(code, context);
  const snapshot = code => JSON.parse(evaluate(`JSON.stringify(${code})`));
  const clickCanvas = () => canvas.emit("pointerdown", { button: 0, clientX: 235, clientY: 237.5 });
  return {
    canvas, picker, options, storage, evaluate, snapshot, clickCanvas,
    choose: number => options.children[number - 1].emit("click"),
    async load() {
      pendingImages.forEach(image => image.onload());
      await ready;
    }
  };
}

test("loading ignores pointer and stage input, then initializes all 16 choices", async () => {
  const game = fixture();
  assert.equal(game.evaluate("typeof state"), "undefined");
  game.clickCanvas();
  game.canvas.emit("pointermove", { clientX: 235, clientY: 237.5 });
  let prevented = false;
  game.canvas.emit("contextmenu", { preventDefault() { prevented = true; } });
  game.evaluate("selectStartStage(16)");
  assert.equal(prevented, true);
  assert.equal(game.evaluate("selectedStartStage"), 1);
  assert.equal(game.picker.hidden, true);
  assert.equal(game.picker.disabled, true);
  assert.equal(game.options.children.length, 0);
  await game.load();
  assert.equal(game.options.children.length, 16);
  assert.deepEqual(game.options.children.map(button => button.textContent),
    Array.from({ length: 16 }, (_, index) => String(index + 1)));
  assert.equal(game.options.children[0].attributes["aria-pressed"], "true");
  assert.equal(game.options.children.filter(button => button.attributes["aria-pressed"] === "true").length, 1);
  assert.equal(game.picker.hidden, false);
  assert.equal(game.picker.disabled, false);
});

for (const stage of [1, 8, 16]) {
  test(`choosing stage ${stage} starts its exact CSV with a fresh game`, async () => {
    const game = fixture();
    await game.load();
    game.choose(stage);
    assert.equal(game.evaluate("state.mode"), "title");
    assert.equal(game.evaluate("selectedStartStage"), stage);
    assert.equal(game.options.children[stage - 1].attributes["aria-pressed"], "true");
    assert.equal(game.options.children.filter(button => button.attributes["aria-pressed"] === "true").length, 1);
    game.evaluate("state.life = 1; state.score = 3450; state.paddle.width = 55; state.clearFrames = 10; state.effects = [{life: 1}]");
    game.clickCanvas();
    assert.deepEqual(game.snapshot("({mode: state.mode, stage: state.stage, life: state.life, score: state.score, ready: state.readyFrames, clear: state.clearFrames, effects: state.effects.length, paddle: state.paddle.width})"),
      { mode: "game", stage, life: 5, score: 0, ready: 120, clear: 0, effects: 0, paddle: 40 });
    assert.deepEqual(game.snapshot("state.blocks"), expectedBlocks(stage));
    assert.equal(game.picker.hidden, true);
    assert.equal(game.picker.disabled, true);
    game.choose(stage === 1 ? 16 : 1);
    assert.equal(game.evaluate("selectedStartStage"), stage);
    assert.equal(game.evaluate("state.stage"), stage);
  });
}

test("stage 15 advances to 16, then all-clear returns to the retained starting choice", async () => {
  const game = fixture();
  await game.load();
  game.choose(15);
  game.clickCanvas();
  game.evaluate("state.score = 1800; state.life = 3; state.paddle.width = 55; state.clearFrames = 1; updateGameFrame()");
  assert.deepEqual(game.snapshot("({stage: state.stage, selected: selectedStartStage, life: state.life, score: state.score, ready: state.readyFrames, paddle: state.paddle.width})"),
    { stage: 16, selected: 15, life: 3, score: 1800, ready: 120, paddle: 40 });
  assert.deepEqual(game.snapshot("state.blocks"), expectedBlocks(16));
  game.evaluate("state.clearFrames = 1; updateGameFrame()");
  assert.equal(game.evaluate("state.mode"), "allclear");
  assert.equal(game.evaluate("state.stage"), 16);
  assert.equal(game.picker.hidden, true);
  game.clickCanvas();
  assert.deepEqual(game.snapshot("({mode: state.mode, stage: state.stage, selected: selectedStartStage, life: state.life, score: state.score, highscore: state.highscore})"),
    { mode: "title", stage: 15, selected: 15, life: 5, score: 0, highscore: 1800 });
  assert.equal(game.picker.hidden, false);
  assert.equal(game.picker.disabled, false);
  assert.equal(game.options.children[14].attributes["aria-pressed"], "true");
});

test("game over retains selected stage, resets life and score, and reloads untouched blocks", async () => {
  const game = fixture();
  await game.load();
  game.choose(8);
  game.clickCanvas();
  game.evaluate(`
    const destroyed = state.blocks.flat().find(block => block.live);
    destroyed.live = false;
    state.score = 2300;
    state.life = 1;
    state.readyFrames = 0;
    state.ball.x = 250;
    state.ball.y = 620;
    state.ball.vx = 0;
    state.ball.vy = 5;
    updateGameFrame();
  `);
  assert.deepEqual(game.snapshot("({mode: state.mode, stage: state.stage, selected: selectedStartStage, life: state.life, score: state.score, highscore: state.highscore})"),
    { mode: "title", stage: 8, selected: 8, life: 5, score: 0, highscore: 2300 });
  assert.deepEqual(game.snapshot("state.blocks"), expectedBlocks(8));
  assert.equal(game.picker.hidden, false);
  assert.equal(game.picker.disabled, false);
  assert.equal(game.options.children[7].attributes["aria-pressed"], "true");
  assert.equal(game.storage.get("block-breaker-web-highscore"), "2300");
  game.clickCanvas();
  assert.deepEqual(game.snapshot("({mode: state.mode, stage: state.stage, life: state.life, score: state.score, ready: state.readyFrames})"),
    { mode: "game", stage: 8, life: 5, score: 0, ready: 120 });
});

test("invalid choices are rejected without changing the selected stage", async () => {
  const game = fixture();
  await game.load();
  game.choose(8);
  game.evaluate("[0, -1, 17, 1.5, NaN, Infinity, '8', null, undefined].forEach(selectStartStage)");
  assert.equal(game.evaluate("selectedStartStage"), 8);
  assert.equal(game.options.children[7].attributes["aria-pressed"], "true");
  assert.equal(game.options.children.filter(button => button.attributes["aria-pressed"] === "true").length, 1);
});
