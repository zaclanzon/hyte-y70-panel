// node --test automata/test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../../hyte_panel/static/ca/core.js");
const { FAMILY } = Core;

const grid = (W, H) => new Uint8Array(W * H * 4);
const get = (buf, W, x, y) => buf[(y * W + x) * 4];
const set = (buf, W, x, y, s) => { buf[(y * W + x) * 4] = s; };
const run = (rule, buf, W, H, n) => { let a = new Uint8Array(buf), b = grid(W, H); for (let i = 0; i < n; i++) { Core.step(rule, a, b, W, H); [a, b] = [b, a]; } return a; };
const cells = (buf, W, H) => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (get(buf, W, x, y)) out.push(`${x},${y}`); return out.sort(); };

test("parseRule handles Life-like and Generations strings", () => {
  assert.deepEqual(Core.parseRule("B3/S23"), { birth: 0b1000, survive: 0b1100, states: 2, family: FAMILY.LIFE });
  assert.deepEqual(Core.parseRule("B36/S23"), { birth: 0b1001000, survive: 0b1100, states: 2, family: FAMILY.LIFE });
  assert.deepEqual(Core.parseRule("b2/s/c3"), { birth: 0b100, survive: 0, states: 3, family: FAMILY.GENERATIONS });
  assert.throws(() => Core.parseRule("B9/S2"));
  assert.throws(() => Core.parseRule("23/3"));
});

test("every built-in rule resolves", () => {
  for (const r of Core.RULES) {
    const res = Core.resolve(r);
    assert.ok(res.family >= 0 && res.family <= 3, r.id);
    assert.ok(res.states >= 2, r.id);
    assert.ok(res.speed > 0, r.id);
  }
});

test("Life: a glider moves one cell down-right every four generations", () => {
  const W = 16, H = 16, rule = Core.resolve({ rule: "B3/S23" });
  let a = grid(W, H);
  // glider pointing toward +x, -y in bottom-up coordinates
  for (const [x, y] of [[1, 10], [2, 9], [0, 8], [1, 8], [2, 8]]) set(a, W, x, y, 1);
  const before = cells(a, W, H);
  const after = cells(run(rule, a, W, H, 4), W, H);
  const shifted = before.map((c) => c.split(",").map(Number)).map(([x, y]) => `${x + 1},${y - 1}`).sort();
  assert.deepEqual(after, shifted);
});

test("Life: blinker oscillates with period 2 and ages", () => {
  const W = 8, H = 8, rule = Core.resolve({ rule: "B3/S23" });
  const a = grid(W, H);
  for (const x of [3, 4, 5]) set(a, W, x, 4, 1);
  const one = run(rule, a, W, H, 1);
  assert.deepEqual(cells(one, W, H), ["4,3", "4,4", "4,5"]);
  assert.equal(one[(4 * W + 4) * 4 + 1], 1, "centre cell survived once: age 1");
  assert.equal(one[(4 * W + 3) * 4 + 2], 255, "cell that died has full glow");
  const two = run(rule, a, W, H, 2);
  assert.deepEqual(cells(two, W, H), cells(a, W, H));
  assert.equal(two[(4 * W + 3) * 4 + 2], 0, "reborn cell has no glow");
  assert.equal(two[(3 * W + 4) * 4 + 2], 255, "just-died cell has full glow");
  assert.equal(two[(4 * W + 4) * 4 + 1], 2, "centre cell is two generations old");
});

test("glow decays by DECAY per dead step", () => {
  const W = 4, H = 4, rule = Core.resolve({ rule: "B3/S23" });
  const a = grid(W, H);
  a[2] = 255; // dead cell with full glow
  const one = run(rule, a, W, H, 1);
  assert.equal(one[2], 255 - Core.DECAY);
  const many = run(rule, a, W, H, 40);
  assert.equal(many[2], 0);
});

test("Brian's Brain: alive -> dying -> dead", () => {
  const W = 6, H = 6, rule = Core.resolve({ rule: "B2/S/C3" });
  const a = grid(W, H);
  set(a, W, 2, 2, 1);
  const one = run(rule, a, W, H, 1);
  assert.equal(get(one, W, 2, 2), 2);
  const two = run(rule, a, W, H, 2);
  assert.equal(get(two, W, 2, 2), 0);
  assert.equal(two[(2 * W + 2) * 4 + 2], 255, "glow set when a dying cell clears");
});

test("Generations: dying cells do not count as neighbours", () => {
  const W = 6, H = 6, rule = Core.resolve({ rule: "B2/S/C3" });
  const a = grid(W, H);
  set(a, W, 1, 1, 2); set(a, W, 3, 1, 2); // two dying cells flank (2,1)
  const one = run(rule, a, W, H, 1);
  assert.equal(get(one, W, 2, 1), 0);
});

test("Rule 30 from a single cell matches the textbook rows", () => {
  const W = 16, H = 4, rule = Core.resolve({ family: FAMILY.ELEMENTARY, wolfram: 30 });
  let a = grid(W, H);
  set(a, W, 8, 0, 1);
  const row = (buf, y) => [...Array(W).keys()].map((x) => get(buf, W, x, y)).join("");
  const one = run(rule, a, W, H, 1);
  assert.equal(row(one, 1), "0000000010000000", "old row scrolled up");
  assert.equal(row(one, 0), "0000000111000000");
  const two = run(rule, a, W, H, 2);
  assert.equal(row(two, 0), "0000001100100000");
  const three = run(rule, a, W, H, 3);
  assert.equal(row(three, 0), "0000011011110000");
  assert.equal(row(three, 3), "0000000010000000", "history keeps scrolling");
});

test("Rule 90 is the XOR of the neighbours and wraps around", () => {
  const W = 8, H = 2, rule = Core.resolve({ family: FAMILY.ELEMENTARY, wolfram: 90 });
  const a = grid(W, H);
  set(a, W, 0, 0, 1);
  const one = run(rule, a, W, H, 1);
  assert.deepEqual([get(one, W, 7, 0), get(one, W, 0, 0), get(one, W, 1, 0)], [1, 0, 1]);
});

test("Cyclic: a cell advances when enough neighbours hold the next state", () => {
  const W = 5, H = 5, rule = Core.resolve({ family: FAMILY.CYCLIC, states: 4, threshold: 2 });
  const a = grid(W, H);
  set(a, W, 2, 2, 0);
  set(a, W, 1, 2, 1);
  let one = run(rule, a, W, H, 1);
  assert.equal(get(one, W, 2, 2), 0, "one neighbour is below the threshold");
  set(a, W, 3, 2, 1);
  one = run(rule, a, W, H, 1);
  assert.equal(get(one, W, 2, 2), 1, "two neighbours advance the cell");
  const b = grid(W, H);
  set(b, W, 2, 2, 3); set(b, W, 1, 2, 0); set(b, W, 3, 2, 0);
  assert.equal(get(run(rule, b, W, H, 1), W, 2, 2), 0, "state wraps from C-1 to 0");
});

test("seedGrid respects the rule family", () => {
  const W = 40, H = 30;
  const life = Core.seedGrid(Core.resolve({ rule: "B3/S23", density: 0.5 }), W, H);
  const m = Core.measure(Core.resolve({ rule: "B3/S23" }), life, W, H);
  assert.ok(m.pop > 300 && m.pop < 900, `life density ~50%: ${m.pop}`);
  const single = Core.seedGrid(Core.resolve({ family: FAMILY.ELEMENTARY, seed: "single" }), W, H);
  assert.equal(Core.measure(Core.resolve({ family: FAMILY.ELEMENTARY }), single, W, H).pop, 1);
  assert.equal(get(single, W, W >> 1, 0), 1);
  const cyc = Core.seedGrid(Core.resolve({ family: FAMILY.CYCLIC, states: 6 }), W, H);
  for (let i = 0; i < W * H; i++) assert.ok(cyc[i * 4] < 6);
});

test("measure hashes the state channel and only the live row for 1D rules", () => {
  const W = 8, H = 4;
  const a = grid(W, H), b = grid(W, H);
  set(a, W, 1, 1, 1); set(b, W, 1, 1, 1);
  assert.equal(Core.measure(Core.resolve({ rule: "B3/S23" }), a, W, H).hash, Core.measure(Core.resolve({ rule: "B3/S23" }), b, W, H).hash);
  set(b, W, 2, 2, 1);
  assert.notEqual(Core.measure(Core.resolve({ rule: "B3/S23" }), a, W, H).hash, Core.measure(Core.resolve({ rule: "B3/S23" }), b, W, H).hash);
  const e = Core.resolve({ family: FAMILY.ELEMENTARY });
  assert.equal(Core.measure(e, a, W, H).pop, 0, "row 1 is history, not live");
  assert.equal(Core.measure(e, a, W, H).cells, W);
});
