/* Ambient light behind the glass: a slow two-color cellular automaton.
   Ported from fantasy-app's ambient-glow (four colors in four corners) down to
   the panel's two accents, seeded as ten blobs. The primary and secondary
   lighting colors start on a jittered checkerboard of ten spots across the
   grid, alternating color so every blob borders the other, and creep into each
   other until the field is covered; a color that over-expands weakens, and one
   squeezed below a floor dies and is absorbed, re-seeding on its own spots
   later so the field never goes flat. Every load draws a fresh seed, fresh
   spots and a fresh pecking order (distinct weights: the dominant color seeds
   larger, pushes and holds harder, and gets more territory before it weakens).
   The order reshuffles every 3–9 s and the drift keeps wandering, so the
   field is never still: lava lamp, not wallpaper. The spots hold until a
   refresh. Deep inside a region, cells with no other color in reach rot away
   to the page color: a speck opens in the center of a blob, repels the live
   cells around it for a few ticks so it grows into a small void, then fades
   and is grown over again. Steps are interpolated so the
   field glides rather than ticks; it freezes for reduced-motion users.
   Positioning and blur live in style.css (.ambient-glow). Palette follows the
   lighting: app.js calls HyteAmbient.setPalette() from applyTheme(). */
(function () {
  "use strict";

  const CELLS = 2600;          // grid area; the aspect follows the viewport
  const TICK_MS = 1000;
  const BLOBS = 10;            // seed spots, dealt alternately to the two colors
  const OVEREXTENDED = 0.55;   // base share past which a color weakens (scaled by weight)
  const DEATH = 0.012;         // share below which a color dies
  const ROT_P = 0.05;          // per-tick chance an interior cell rots to the page color
  const REPEL_P = 0.14;        // per-tick chance a live cell next to a fresh void joins it
  const VOID_TICKS = 6;        // how long a void repels before it can be grown over
  const RANK_WEIGHTS = [1.35, 0.7]; // dominant, weakest
  const RESPAWN_TICKS = 40;
  const WARMUP_TICKS = 9;      // start ~12 s in: regions already spread and meeting
  const RESHUFFLE_MS = [3000, 9000];
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
  // The caps sum past 1 so the two colors can cover the whole field between them.
  const cap = (c) => Math.min(0.8, OVEREXTENDED * weight[c]);

  // --- state ---
  let owner = new Int8Array(N).fill(PAGE);
  let prev = new Int8Array(N).fill(PAGE);
  const wind = [0, 1].map(() => [Math.random() - 0.5, Math.random() - 0.5]);
  const alive = [true, true];
  const hollow = new Uint8Array(N); // ticks of repulsion left in a rotted page cell
  const deadSince = [0, 0];
  let tick = 0;

  function seed(c, cx, cy, r) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - cx) / W, ((y - cy) / H) * (H / W)) / r;
        if (d + (Math.random() - 0.5) * 0.35 < 1) owner[y * W + x] = c;
      }
  }
  // Ten spots on a jittered grid shaped to the viewport, colored as a
  // checkerboard so neighbors alternate. They belong to their color for the
  // life of the page (a respawn returns home). A random flip per load decides
  // which color takes the even squares.
  const cols = Math.max(1, Math.round(Math.sqrt(BLOBS * W / H)));
  const rows = Math.ceil(BLOBS / cols);
  const flip = Math.random() < 0.5 ? 1 : 0;
  const spots = [[], []];
  for (let k = 0; k < BLOBS; k++) {
    const col = k % cols, row = Math.floor(k / cols);
    const c = (col + row + flip) % COLORS;
    spots[c].push([((col + 0.25 + Math.random() * 0.5) / cols) * W, ((row + 0.25 + Math.random() * 0.5) / rows) * H]);
  }
  const home = (c, r) => spots[c].forEach(([cx, cy]) => seed(c, cx, cy, r));
  for (let c = 0; c < COLORS; c++) home(c, 0.12 + 0.05 * weight[c]);

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
        home(c, 0.04 + 0.03 * weight[c]);
      }
    }

    // Slowly wandering drift per color: regions creep rather than boil.
    for (const w of wind) {
      w[0] += (Math.random() - 0.5) * 0.45;
      w[1] += (Math.random() - 0.5) * 0.45;
      const m = Math.hypot(w[0], w[1]) || 1;
      w[0] /= m;
      w[1] /= m;
    }

    prev = owner;
    const next = new Int8Array(owner);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        tally.fill(0);
        const i = y * W + x;
        const cur = owner[i];
        let same = 0;
        let voidNear = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + W) % W;
            const ny = Math.min(H - 1, Math.max(0, y + dy));
            const j = ny * W + nx;
            const o = owner[j];
            if (o === PAGE) { voidNear = Math.max(voidNear, hollow[j]); continue; }
            if (o === cur) same++;
            // Neighbors upwind of this cell push harder into it.
            tally[o] += 1 + 1.0 * (-(dx * wind[o][0]) - dy * wind[o][1]);
          }
        if (cur !== PAGE) {
          // Rot: buried cells open a speck; a fresh void repels its neighbors
          // so the speck grows for a few ticks before it fades.
          if (same === 8 && Math.random() < ROT_P) { next[i] = PAGE; hollow[i] = VOID_TICKS; continue; }
          if (voidNear > 1 && Math.random() < REPEL_P * (voidNear / VOID_TICKS)) { next[i] = PAGE; hollow[i] = voidNear - 1; continue; }
        }
        let best = -1;
        let bestT = 0;
        for (let c = 0; c < COLORS; c++) {
          if (c === cur) continue;
          const t = tally[c] * weight[c] * (share(c) > cap(c) ? 0.35 : 1) + Math.random() * 0.6;
          if (t > bestT) { bestT = t; best = c; }
        }
        if (best < 0) continue;
        const defense = cur === PAGE ? 1.1 + 2.5 * (hollow[i] / VOID_TICKS) : tally[cur] * weight[cur] * (share(cur) > cap(cur) ? 0.5 : 1) + 1.6;
        if (bestT > defense && Math.random() < 0.6) next[i] = best;
      }
    owner = next;
    for (let i = 0; i < N; i++) if (hollow[i]) hollow[i]--;
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
