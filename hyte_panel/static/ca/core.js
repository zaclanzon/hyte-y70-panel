/* Cellular automata core: rule table, rule parsing and a CPU reference stepper.
   Shared by the browser module (WebGL engine + fallback) and the node tests.
   Cell layout is 4 bytes per cell, matching the GPU texture:
     [0] state   0 = dead, 1 = alive, 2..C-1 = dying (Generations) / phase (Cyclic)
     [1] age     steps the cell has been alive, saturating at 255
     [2] glow    afterglow left when a cell dies, decays each step
     [3] unused
   Row 0 is the bottom of the grid (GL texel order). Elementary rules scroll up:
   every step row y copies row y-1 and row 0 is recomputed from itself. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CACore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FAMILY = { LIFE: 0, GENERATIONS: 1, ELEMENTARY: 2, CYCLIC: 3 };
  const DECAY = 10; // glow lost per step; 255/10 ≈ 25 steps of trail

  /** Parse "B3/S23", "B36/S23", "B2/S/C3" (C = number of states, Generations). */
  function parseRule(str) {
    const m = /^B([0-8]*)\/S([0-8]*)(?:\/C(\d+))?$/i.exec(String(str).replace(/\s+/g, ""));
    if (!m) throw new Error(`bad rule string: ${str}`);
    const mask = (digits) => [...digits].reduce((acc, d) => acc | (1 << +d), 0);
    const states = m[3] ? Math.max(3, Math.min(255, +m[3])) : 2;
    return { birth: mask(m[1]), survive: mask(m[2]), states, family: states > 2 ? FAMILY.GENERATIONS : FAMILY.LIFE };
  }

  const RULES = [
    { id: "life", name: "Life", rule: "B3/S23", density: 0.28, speed: 15, attract: true,
      blurb: "Conway's original. Gliders, blinkers and the occasional spaceship." },
    { id: "highlife", name: "HighLife", rule: "B36/S23", density: 0.25, speed: 15, attract: true,
      blurb: "Life plus birth on six. Home of the replicator." },
    { id: "daynight", name: "Day & Night", rule: "B3678/S34678", density: 0.5, speed: 12, attract: true,
      blurb: "Symmetric under inversion: dead and alive trade places freely." },
    { id: "diamoeba", name: "Diamoeba", rule: "B35678/S5678", density: 0.48, speed: 12, attract: true,
      blurb: "Diamond-shaped blobs that grow, split and eat each other." },
    { id: "coral", name: "Coral", rule: "B3/S45678", density: 0.08, speed: 20, attract: true,
      blurb: "Slow reef growth with a textured edge." },
    { id: "maze", name: "Maze", rule: "B3/S12345", density: 0.06, speed: 20, attract: true,
      blurb: "Grows a labyrinth from a few seeds, then freezes." },
    { id: "anneal", name: "Anneal", rule: "B4678/S35678", density: 0.5, speed: 20, attract: true,
      blurb: "Majority vote with a twist: regions smooth out like cooling metal." },
    { id: "seeds", name: "Seeds", rule: "B2/S", density: 0.02, speed: 30, attract: true,
      blurb: "Every cell dies each step. Everything is an explosion." },
    { id: "brain", name: "Brian's Brain", rule: "B2/S/C3", density: 0.3, speed: 30, attract: true,
      blurb: "Three states: alive, dying, dead. Endless diagonal traffic." },
    { id: "starwars", name: "Star Wars", rule: "B2/S345/C4", density: 0.3, speed: 24, attract: true,
      blurb: "Generations rule with ships, guns and long dying trails." },
    { id: "rule30", name: "Rule 30", family: FAMILY.ELEMENTARY, wolfram: 30, seed: "single", speed: 30, attract: true,
      blurb: "Wolfram's chaotic one. A random-looking triangle from a single cell." },
    { id: "rule90", name: "Rule 90", family: FAMILY.ELEMENTARY, wolfram: 90, seed: "single", speed: 30, attract: true,
      blurb: "XOR of the two neighbours: the Sierpinski triangle." },
    { id: "rule110", name: "Rule 110", family: FAMILY.ELEMENTARY, wolfram: 110, density: 0.5, speed: 30, attract: true,
      blurb: "Turing complete. Gliders drift through a periodic background." },
    { id: "rule184", name: "Rule 184", family: FAMILY.ELEMENTARY, wolfram: 184, density: 0.5, speed: 30, attract: false,
      blurb: "Traffic flow. Cars move right when the road ahead is clear." },
    { id: "cyclic", name: "Cyclic", family: FAMILY.CYCLIC, states: 14, threshold: 1, speed: 20, attract: true,
      blurb: "Each colour is eaten by the next. Spirals grow out of noise." },
    { id: "cyclic3", name: "Cyclic T3", family: FAMILY.CYCLIC, states: 8, threshold: 3, speed: 20, attract: true,
      blurb: "Stricter threshold: chunkier fronts and slow demon spirals." },
  ];

  /** Fill in computed fields (masks, family) for a rule entry. */
  function resolve(r) {
    const out = Object.assign({ density: 0.3, speed: 15, decay: DECAY }, r);
    if (r.rule) Object.assign(out, parseRule(r.rule));
    if (out.family === undefined) out.family = FAMILY.LIFE;
    if (out.family === FAMILY.ELEMENTARY) out.states = 2;
    if (out.states === undefined) out.states = 2;
    if (out.threshold === undefined) out.threshold = 1;
    if (out.wolfram === undefined) out.wolfram = 0;
    return out;
  }

  const rand = (rng) => (rng ? rng() : Math.random());

  /** Create an RGBA8 cell buffer seeded for the rule. */
  function seedGrid(rule, W, H, rng) {
    const buf = new Uint8Array(W * H * 4);
    const set = (x, y, s) => { buf[(y * W + x) * 4] = s; };
    if (rule.family === FAMILY.ELEMENTARY) {
      if (rule.seed === "single") set(W >> 1, 0, 1);
      else for (let x = 0; x < W; x++) if (rand(rng) < rule.density) set(x, 0, 1);
    } else if (rule.family === FAMILY.CYCLIC) {
      for (let i = 0; i < W * H; i++) buf[i * 4] = Math.floor(rand(rng) * rule.states);
    } else {
      for (let i = 0; i < W * H; i++) if (rand(rng) < rule.density) buf[i * 4] = 1;
    }
    return buf;
  }

  /** One generation on the CPU. src and dst are RGBA8 buffers of W*H cells. */
  function step(rule, src, dst, W, H) {
    const F = rule.family, C = rule.states, decay = rule.decay;
    if (F === FAMILY.ELEMENTARY) {
      // rows 1..H-1 copy the row below; row 0 is recomputed from itself
      dst.set(src.subarray(0, (H - 1) * W * 4), W * 4);
      for (let x = 0; x < W; x++) {
        const l = src[(x === 0 ? W - 1 : x - 1) * 4], c = src[x * 4], r = src[(x + 1 === W ? 0 : x + 1) * 4];
        const o = x * 4;
        dst[o] = (rule.wolfram >> ((l << 2) | (c << 1) | r)) & 1;
        dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0;
      }
      return;
    }
    for (let y = 0; y < H; y++) {
      // Only the edge wraps; avoid integer remainder for every cell.
      const ym = (y === 0 ? H - 1 : y - 1) * W, y0 = y * W, yp = (y + 1 === H ? 0 : y + 1) * W;
      for (let x = 0; x < W; x++) {
        const xm = x === 0 ? W - 1 : x - 1, xp = x + 1 === W ? 0 : x + 1;
        const i = y0 + x, o = i * 4;
        const s = src[o], age = src[o + 1], glow = src[o + 2];
        let target = 1;
        if (F === FAMILY.CYCLIC) target = (s + 1) % C;
        let n = 0;
        if (src[(ym + xm) * 4] === target) n++;
        if (src[(ym + x) * 4] === target) n++;
        if (src[(ym + xp) * 4] === target) n++;
        if (src[(y0 + xm) * 4] === target) n++;
        if (src[(y0 + xp) * 4] === target) n++;
        if (src[(yp + xm) * 4] === target) n++;
        if (src[(yp + x) * 4] === target) n++;
        if (src[(yp + xp) * 4] === target) n++;
        let ns, nage, nglow;
        if (F === FAMILY.CYCLIC) {
          ns = n >= rule.threshold ? target : s;
          nage = ns === s ? Math.min(age + 1, 255) : 0;
          nglow = 0;
        } else if (s === 0) {
          ns = (rule.birth >> n) & 1;
          nage = 0;
          nglow = ns ? 0 : Math.max(glow - decay, 0);
        } else if (s === 1) {
          const survive = (rule.survive >> n) & 1;
          ns = survive ? 1 : C > 2 ? 2 : 0;
          nage = survive ? Math.min(age + 1, 255) : 0;
          nglow = survive ? 0 : 255;
        } else {
          ns = s + 1 < C ? s + 1 : 0;
          nage = 0;
          nglow = ns === 0 ? 255 : 0;
        }
        dst[o] = ns; dst[o + 1] = nage; dst[o + 2] = nglow; dst[o + 3] = 0;
      }
    }
  }

  /** Population (cells with state > 0) and a cheap hash of the state channel.
      For elementary rules only the live row counts. */
  function measure(rule, buf, W, H) {
    const cells = rule.family === FAMILY.ELEMENTARY ? W : W * H;
    let pop = 0, hash = 2166136261;
    for (let i = 0; i < cells; i++) {
      const s = buf[i * 4];
      if (s > 0) pop++;
      hash = Math.imul(hash ^ s, 16777619) >>> 0;
    }
    return { pop, hash, cells };
  }

  // Patterns for stamping. "O" = alive. Drawn with the first line at the top.
  const STAMPS = [
    { id: "glider", name: "Glider", rows: [".O.", "..O", "OOO"] },
    { id: "lwss", name: "Lightweight spaceship", rows: [".O..O", "O....", "O...O", "OOOO."] },
    { id: "rpent", name: "R-pentomino", rows: [".OO", "OO.", ".O."] },
    { id: "acorn", name: "Acorn", rows: [".O.....", "...O...", "OO..OOO"] },
    { id: "gun", name: "Gosper glider gun", rows: [
      "........................O...........",
      "......................O.O...........",
      "............OO......OO............OO",
      "...........O...O....OO............OO",
      "OO........O.....O...OO..............",
      "OO........O...O.OO....O.O...........",
      "..........O.....O.......O...........",
      "...........O...O....................",
      "............OO......................"] },
    { id: "pulsar", name: "Pulsar", rows: [
      "..OOO...OOO..", ".............", "O....O.O....O", "O....O.O....O", "O....O.O....O", "..OOO...OOO..",
      ".............", "..OOO...OOO..", "O....O.O....O", "O....O.O....O", "O....O.O....O", ".............", "..OOO...OOO.."] },
  ];

  return { FAMILY, DECAY, RULES, STAMPS, parseRule, resolve, seedGrid, step, measure };
});
