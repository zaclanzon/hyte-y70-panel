/* Ambient light behind the glass: a slow two-color cellular automaton.
   Ported from fantasy-app's ambient-glow (four colors) down to the panel's two
   accents. The primary and secondary lighting colors start in random corners on
   a coarse grid and creep into each other; a color that over-expands weakens,
   and one squeezed below a floor dies and is absorbed, re-seeding in its own
   corner later so the field never goes flat. Every load draws a fresh seed, a
   fresh corner per color and a fresh pecking order (distinct weights: the
   dominant color seeds larger, pushes and holds harder, and gets more territory
   before it weakens). The order reshuffles every 5–15 s so the two keep
   fighting; the corners hold until a refresh. Steps are interpolated so the
   field glides rather than ticks; it freezes for reduced-motion users.
   Positioning and blur live in style.css (.ambient-glow). Palette follows the
   lighting: app.js calls HyteAmbient.setPalette() from applyTheme(). */
(function () {
  "use strict";

  const CELLS = 2600;          // grid area; the aspect follows the viewport
  const TICK_MS = 1400;
  const OVEREXTENDED = 0.45;   // base share past which a color weakens (scaled by weight)
  const DEATH = 0.012;         // share below which a color dies
  const RANK_WEIGHTS = [1.35, 0.7]; // dominant, weakest
  const RESPAWN_TICKS = 40;
  const WARMUP_TICKS = 9;      // start ~12 s in: regions already spread and meeting
  const RESHUFFLE_MS = [5000, 15000];
  const DIM = 0.45;            // how far each accent is pulled toward the page color
  const PAGE = -1;
  const COLORS = 2;

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // Resolve a CSS color (a var() included) to rgb via a scratch element.
  function cssRgb(value) {
    const el = document.createElement("span");
    el.style.color = value;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    el.remove();
    const m = computed.match(/[\d.]+/g);
    if (!m) return [0, 0, 0];
    const unit = computed.startsWith("color(");
    return [0, 1, 2].map((i) => Number(m[i]) * (unit ? 255 : 1));
  }

  const canvas = document.querySelector(".ambient-glow canvas");
  const ctx = canvas && canvas.getContext("2d");
  if (!ctx) { window.HyteAmbient = { setPalette() {} }; return; }

  const aspect = Math.max(0.2, Math.min(5, innerWidth / innerHeight || 1));
  const W = Math.max(12, Math.round(Math.sqrt(CELLS * aspect)));
  const H = Math.max(12, Math.round(W / aspect));
  const N = W * H;
  canvas.width = W;
  canvas.height = H;

  const page = cssRgb("var(--bg-0)");
  let palette = [];
  function setPalette(primary, secondary) {
    palette = [primary, secondary].map((c) => mix(hexToRgb(c), page, DIM));
  }
  const colorOf = (o) => (o === PAGE ? page : palette[o]);

  // --- hierarchy: a random permutation of the ranks, reshuffled on a long stay ---
  const weight = [0, 0];
  function shuffleRanks() {
    const order = [0, 1].sort(() => Math.random() - 0.5);
    order.forEach((c, rank) => (weight[c] = RANK_WEIGHTS[rank]));
  }
  shuffleRanks();
  let nextShuffle = 0;
  const scheduleShuffle = (now) =>
    (nextShuffle = now + RESHUFFLE_MS[0] + Math.random() * (RESHUFFLE_MS[1] - RESHUFFLE_MS[0]));
  const cap = (c) => Math.min(0.6, OVEREXTENDED * weight[c]);

  // --- state ---
  let owner = new Int8Array(N).fill(PAGE);
  let prev = new Int8Array(N).fill(PAGE);
  const wind = [0, 1].map(() => [Math.random() - 0.5, Math.random() - 0.5]);
  const alive = [true, true];
  const deadSince = [0, 0];
  let tick = 0;

  function seed(c, cx, cy, r) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - cx) / W, ((y - cy) / H) * (H / W)) / r;
        if (d + (Math.random() - 0.5) * 0.35 < 1) owner[y * W + x] = c;
      }
  }
  // Two of the four corners are dealt out at random per load and then belong
  // to their color for the life of the page (a respawn returns home).
  const corners = [[0, 0], [W, 0], [W, H], [0, H]].sort(() => Math.random() - 0.5);
  corners.slice(0, COLORS).forEach(([cx, cy], c) => seed(c, cx, cy, 0.3 + 0.15 * weight[c]));

  const counts = new Int32Array(COLORS + 1);
  const tally = new Float32Array(COLORS);

  function step(now) {
    tick++;
    if (now >= nextShuffle) { shuffleRanks(); scheduleShuffle(now); }
    counts.fill(0);
    for (let i = 0; i < N; i++) counts[owner[i] + 1]++;
    const share = (c) => counts[c + 1] / N;

    // Death and respawn.
    for (let c = 0; c < COLORS; c++) {
      if (alive[c] && share(c) < DEATH) {
        alive[c] = false;
        deadSince[c] = tick;
        for (let i = 0; i < N; i++) if (owner[i] === c) owner[i] = PAGE;
      } else if (!alive[c] && tick - deadSince[c] > RESPAWN_TICKS) {
        alive[c] = true;
        seed(c, corners[c][0], corners[c][1], 0.08 + 0.05 * weight[c]);
      }
    }

    // Slowly wandering drift per color: regions creep rather than boil.
    for (const w of wind) {
      w[0] += (Math.random() - 0.5) * 0.3;
      w[1] += (Math.random() - 0.5) * 0.3;
      const m = Math.hypot(w[0], w[1]) || 1;
      w[0] /= m;
      w[1] /= m;
    }

    prev = owner;
    const next = new Int8Array(owner);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        tally.fill(0);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + W) % W;
            const ny = Math.min(H - 1, Math.max(0, y + dy));
            const o = owner[ny * W + nx];
            if (o === PAGE) continue;
            // Neighbors upwind of this cell push harder into it.
            tally[o] += 1 + 0.7 * (-(dx * wind[o][0]) - dy * wind[o][1]);
          }
        const i = y * W + x;
        const cur = owner[i];
        let best = -1;
        let bestT = 0;
        for (let c = 0; c < COLORS; c++) {
          if (c === cur) continue;
          const t = tally[c] * weight[c] * (share(c) > cap(c) ? 0.35 : 1) + Math.random() * 0.6;
          if (t > bestT) { bestT = t; best = c; }
        }
        if (best < 0) continue;
        const defense = cur === PAGE ? 1.1 : tally[cur] * weight[cur] * (share(cur) > cap(cur) ? 0.5 : 1) + 1.6;
        if (bestT > defense && Math.random() < 0.5) next[i] = best;
      }
    owner = next;
  }

  // --- render: lerp between the previous and current grid ---
  const img = ctx.createImageData(W, H);
  const px = img.data;
  function draw(t) {
    for (let i = 0; i < N; i++) {
      const c = mix(colorOf(prev[i]), colorOf(owner[i]), t);
      const o = i * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  const styles = getComputedStyle(document.documentElement);
  setPalette(styles.getPropertyValue("--accent").trim() || "#ff2d3f",
             styles.getPropertyValue("--accent-2").trim() || "#3d7bff");

  // Skip the empty opening: run the field forward before the first paint.
  nextShuffle = Infinity;
  for (let i = 0; i < WARMUP_TICKS; i++) step(0);
  prev = owner;

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastT = 1;
  draw(1);
  window.HyteAmbient = {
    setPalette(primary, secondary) {
      setPalette(primary, secondary);
      if (still) draw(lastT);
    },
  };
  if (still) return;

  let last = performance.now();
  scheduleShuffle(last);
  function frame(now) {
    if (now - last >= TICK_MS) { step(now); last = now; }
    // Ease so each step lands softly.
    const t = Math.min(1, (now - last) / TICK_MS);
    lastT = t * t * (3 - 2 * t);
    draw(lastT);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
