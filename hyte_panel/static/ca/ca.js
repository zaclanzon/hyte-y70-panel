/* Cellular automata playground module. Vanilla JS, no build step.
   Usage:  const ca = CA.mount(element, options)
   Requires ca/core.js (window.CACore) loaded first.

   The world lives in a WebGL2 RGBA8UI texture pair (ping-pong). One fragment
   shader steps every rule family; a second draws the state with the host's
   palette. A CPU engine with the same interface is used when WebGL2 fails. */
(function (root) {
  "use strict";
  const Core = root.CACore;
  const { FAMILY } = Core;

  const SPEEDS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 240];
  const MAX_STEPS_PER_FRAME = 120;
  // Canvas presents per second. Steps run at the rule's generations/s; the
  // picture only needs to refresh this often, and each present repaints the card.
  const RENDER_FPS = 10;

  // ---- Colors ---------------------------------------------------------------------
  const probeCtx = (() => { try { return document.createElement("canvas").getContext("2d", { willReadFrequently: true }); } catch (e) { return null; } })();
  /** Any CSS color string -> [r,g,b] in 0..1. */
  function parseColor(str, fallback) {
    if (!probeCtx || !str) return fallback;
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = "#000";
    probeCtx.fillStyle = str.trim();
    probeCtx.fillRect(0, 0, 1, 1);
    const d = probeCtx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  }
  const DEFAULT_THEME = { primary: "#ff2d3f", secondary: "#3d7bff", blend: "#b23cff" };

  // ---- Shaders --------------------------------------------------------------------
  const VS = `#version 300 es
  in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS_STEP = `#version 300 es
  precision highp float; precision highp int; precision highp usampler2D;
  uniform usampler2D u_state; uniform ivec2 u_size;
  uniform int u_family; uniform uint u_birth; uniform uint u_survive;
  uniform uint u_states; uniform uint u_rule; uniform uint u_thresh; uniform uint u_decay;
  out uvec4 o;
  uvec4 at(ivec2 p) { return texelFetch(u_state, (p + u_size) % u_size, 0); }
  void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    uvec4 s = at(c);
    if (u_family == 2) {                       // elementary: scroll up, recompute row 0
      if (c.y > 0) { o = at(c - ivec2(0, 1)); return; }
      uint l = at(c + ivec2(-1, 0)).r, m = s.r, r = at(c + ivec2(1, 0)).r;
      uint idx = (l << 2) | (m << 1) | r;
      o = uvec4((u_rule >> idx) & 1u, 0u, 0u, 0u);
      return;
    }
    uint target = (u_family == 3) ? (s.r + 1u) % u_states : 1u;
    uint n = 0u;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      if (at(c + ivec2(dx, dy)).r == target) n++;
    }
    uint st = s.r, age = s.g, glow = s.b;
    uint ns, nage, nglow;
    if (u_family == 3) {                       // cyclic
      ns = n >= u_thresh ? target : st;
      nage = ns == st ? min(age + 1u, 255u) : 0u;
      nglow = 0u;
    } else if (st == 0u) {
      ns = (u_birth >> n) & 1u;
      nage = 0u;
      nglow = ns == 1u ? 0u : (glow > u_decay ? glow - u_decay : 0u);
    } else if (st == 1u) {
      bool sv = ((u_survive >> n) & 1u) == 1u;
      ns = sv ? 1u : (u_states > 2u ? 2u : 0u);
      nage = sv ? min(age + 1u, 255u) : 0u;
      nglow = sv ? 0u : 255u;
    } else {
      ns = st + 1u < u_states ? st + 1u : 0u;
      nage = 0u;
      nglow = ns == 0u ? 255u : 0u;
    }
    o = uvec4(ns, nage, nglow, 0u);
  }`;

  const FS_DRAW = `#version 300 es
  precision highp float; precision highp int; precision highp usampler2D;
  uniform usampler2D u_state; uniform ivec2 u_size; uniform vec2 u_canvas;
  uniform int u_family; uniform uint u_states;
  uniform vec3 u_young; uniform vec3 u_old; uniform vec3 u_dying;
  out vec4 o;
  vec3 wheel(float t) {                        // young -> old -> dying -> young
    t = fract(t) * 3.0;
    if (t < 1.0) return mix(u_young, u_old, t);
    if (t < 2.0) return mix(u_old, u_dying, t - 1.0);
    return mix(u_dying, u_young, t - 2.0);
  }
  void main() {
    ivec2 g = ivec2(floor(gl_FragCoord.xy / u_canvas * vec2(u_size)));
    uvec4 s = texelFetch(u_state, g, 0);
    vec3 col = vec3(0.0); float a = 0.0;
    if (u_family == 2) {
      if (s.r == 1u) { float t = float(g.y) / float(u_size.y); col = mix(u_young, u_old, min(t * 2.5, 1.0)); a = 1.0 - t * 0.7; }
    } else if (u_family == 3) {
      col = wheel(float(s.r) / float(u_states)); a = 0.9;
    } else {
      if (s.r == 1u) { col = mix(u_young, u_old, clamp(float(s.g) / 24.0, 0.0, 1.0)); a = 1.0; }
      else if (s.r > 1u) { float t = float(s.r - 2u) / float(max(u_states - 2u, 1u)); col = u_dying; a = 0.85 * (1.0 - t * 0.8); }
      else if (s.b > 0u) { col = u_dying; a = float(s.b) / 255.0 * 0.45; }
    }
    o = vec4(col * a, a);                      // premultiplied
  }`;

  // ---- WebGL engine -----------------------------------------------------------------
  class GLEngine {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
      if (!gl) throw new Error("WebGL2 unavailable");
      this.gl = gl;
      this.kind = "gpu";
      this.pStep = this._program(VS, FS_STEP);
      this.pDraw = this._program(VS, FS_DRAW);
      this.u = { step: this._uniforms(this.pStep, ["u_state", "u_size", "u_family", "u_birth", "u_survive", "u_states", "u_rule", "u_thresh", "u_decay"]),
                 draw: this._uniforms(this.pDraw, ["u_state", "u_size", "u_canvas", "u_family", "u_states", "u_young", "u_old", "u_dying"]) };
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      for (const p of [this.pStep, this.pDraw]) {
        gl.useProgram(p);
        const loc = gl.getAttribLocation(p, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
      gl.disable(gl.BLEND);
      this.tex = []; this.fb = []; this.cur = 0; this.W = 0; this.H = 0;
    }
    _program(vs, fs) {
      const gl = this.gl, p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    _uniforms(p, names) { const o = {}; for (const n of names) o[n] = this.gl.getUniformLocation(p, n); return o; }

    /** Allocate a W x H world and load buf (RGBA8, or null for empty). */
    resize(W, H, buf) {
      const gl = this.gl;
      for (const t of this.tex) gl.deleteTexture(t);
      for (const f of this.fb) gl.deleteFramebuffer(f);
      this.tex = []; this.fb = []; this.W = W; this.H = H; this.cur = 0;
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, W, H, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, i === 0 ? buf : null);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        this.tex.push(t); this.fb.push(f);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    load(buf) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, buf);
    }
    setRule(rule) {
      const gl = this.gl, u = this.u.step;
      this.rule = rule;
      gl.useProgram(this.pStep);
      gl.uniform1i(u.u_family, rule.family);
      gl.uniform1ui(u.u_birth, rule.birth >>> 0);
      gl.uniform1ui(u.u_survive, rule.survive >>> 0);
      gl.uniform1ui(u.u_states, rule.states);
      gl.uniform1ui(u.u_rule, rule.wolfram);
      gl.uniform1ui(u.u_thresh, rule.threshold);
      gl.uniform1ui(u.u_decay, rule.decay);
    }
    step(n) {
      const gl = this.gl;
      gl.useProgram(this.pStep);
      gl.uniform2i(this.u.step.u_size, this.W, this.H);
      gl.uniform1i(this.u.step.u_state, 0);
      gl.viewport(0, 0, this.W, this.H);
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < n; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1 - this.cur]);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.cur = 1 - this.cur;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    /** Write an RGBA8 block at grid position (x, y). Clipped to the grid. */
    paint(x, y, w, h, data) {
      const gl = this.gl;
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.W, x + w), y1 = Math.min(this.H, y + h);
      if (x1 <= x0 || y1 <= y0) return;
      let block = data;
      if (x0 !== x || y0 !== y || x1 - x0 !== w || y1 - y0 !== h) {
        block = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
        for (let yy = y0; yy < y1; yy++) block.set(data.subarray(((yy - y) * w + (x0 - x)) * 4, ((yy - y) * w + (x1 - x)) * 4), (yy - y0) * (x1 - x0) * 4);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, block);
    }
    read(buf) {
      const gl = this.gl;
      buf = buf || new Uint8Array(this.W * this.H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[this.cur]);
      gl.readPixels(0, 0, this.W, this.H, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return buf;
    }
    render(theme) {
      const gl = this.gl, u = this.u.draw, c = this.canvas;
      gl.useProgram(this.pDraw);
      gl.viewport(0, 0, c.width, c.height);
      gl.uniform2i(u.u_size, this.W, this.H);
      gl.uniform2f(u.u_canvas, c.width, c.height);
      gl.uniform1i(u.u_family, this.rule.family);
      gl.uniform1ui(u.u_states, this.rule.states);
      gl.uniform3fv(u.u_young, theme.young);
      gl.uniform3fv(u.u_old, theme.old);
      gl.uniform3fv(u.u_dying, theme.dying);
      gl.uniform1i(u.u_state, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    destroy() { const ext = this.gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); }
  }

  // ---- CPU engine (fallback + reference) --------------------------------------------
  class CPUEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.kind = "cpu";
      this.W = 0; this.H = 0;
    }
    resize(W, H, buf) {
      this.W = W; this.H = H;
      this.a = buf ? new Uint8Array(buf) : new Uint8Array(W * H * 4);
      this.b = new Uint8Array(W * H * 4);
      this.img = null;
    }
    load(buf) { this.a.set(buf); }
    setRule(rule) { this.rule = rule; }
    step(n) {
      for (let i = 0; i < n; i++) { Core.step(this.rule, this.a, this.b, this.W, this.H); [this.a, this.b] = [this.b, this.a]; }
    }
    paint(x, y, w, h, data) {
      for (let yy = 0; yy < h; yy++) {
        const gy = y + yy; if (gy < 0 || gy >= this.H) continue;
        for (let xx = 0; xx < w; xx++) {
          const gx = x + xx; if (gx < 0 || gx >= this.W) continue;
          this.a.set(data.subarray((yy * w + xx) * 4, (yy * w + xx) * 4 + 4), (gy * this.W + gx) * 4);
        }
      }
    }
    read(buf) { buf = buf || new Uint8Array(this.W * this.H * 4); buf.set(this.a); return buf; }
    render(theme) {
      const { W, H, rule, a, ctx, canvas } = this;
      if (!this.img || this.img.width !== W || this.img.height !== H) this.img = ctx.createImageData(W, H);
      const px = this.img.data;
      const young = theme.young.map((v) => v * 255), old = theme.old.map((v) => v * 255), dying = theme.dying.map((v) => v * 255);
      const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      const wheel = (t) => { t = (t % 1) * 3; return t < 1 ? mix(young, old, t) : t < 2 ? mix(old, dying, t - 1) : mix(dying, young, t - 2); };
      for (let y = 0; y < H; y++) {
        const row = (H - 1 - y) * W; // canvas y is top-down; grid row 0 is the bottom
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, o = (row + x) * 4;
          const s = a[i];
          let col = null, al = 0;
          if (rule.family === FAMILY.ELEMENTARY) {
            if (s === 1) { const t = y / H; col = mix(young, old, Math.min(t * 2.5, 1)); al = 1 - t * 0.7; }
          } else if (rule.family === FAMILY.CYCLIC) { col = wheel(s / rule.states); al = 0.9; }
          else if (s === 1) { col = mix(young, old, Math.min(a[i + 1] / 24, 1)); al = 1; }
          else if (s > 1) { col = dying; al = 0.85 * (1 - ((s - 2) / Math.max(rule.states - 2, 1)) * 0.8); }
          else if (a[i + 2] > 0) { col = dying; al = (a[i + 2] / 255) * 0.45; }
          if (col) { px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = al * 255; }
          else px[o + 3] = 0;
        }
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      if (canvas.width === W && canvas.height === H) ctx.putImageData(this.img, 0, 0);
      else {
        if (!this.tmp) { this.tmp = document.createElement("canvas"); }
        if (this.tmp.width !== W || this.tmp.height !== H) { this.tmp.width = W; this.tmp.height = H; }
        this.tmp.getContext("2d").putImageData(this.img, 0, 0);
        ctx.drawImage(this.tmp, 0, 0, canvas.width, canvas.height);
      }
    }
    destroy() {}
  }

  // ---- Icons --------------------------------------------------------------------------
  const ICON = {
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause: '<rect x="5" y="4" width="4.5" height="16" rx="1"/><rect x="14.5" y="4" width="4.5" height="16" rx="1"/>',
    step: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
    seed: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/>',
    clear: '<path d="M4 20h16"/><path d="M14.5 4.5l5 5L9 20H4v-5z"/>',
    speed: '<path d="M12 2a10 10 0 1 0 10 10"/><polyline points="12 6 12 12 16 14"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

  // ---- Controller ------------------------------------------------------------------------
  function mount(el, opts = {}) {
    const o = Object.assign({
      rule: "life", cell: 2, header: true, title: "Automata", autoplay: true, engine: "auto",
      attract: { idle: 45, rotate: 120 }, theme: null, size: null, speed: null, reactive: true,
    }, opts);
    if (o.attract === true) o.attract = { idle: 45, rotate: 120 };

    el.classList.add("ca");
    el.innerHTML = `
      ${o.header ? `<div class="ca-head"><span class="ca-title">${o.title}</span><span class="ca-status">starting</span></div>` : ""}
      <div class="ca-stage">
        <canvas></canvas>
        <div class="ca-toast" hidden></div>
        <div class="ca-menu" hidden></div>
        <div class="ca-picker" hidden></div>
      </div>
      <div class="ca-bar">
        <button class="ca-pill ca-rule" title="Choose a rule"><b></b><small></small></button>
        <button class="ca-btn ca-play" title="Play / pause">${svg("pause")}</button>
        <button class="ca-btn ca-step" title="One generation">${svg("step")}</button>
        <button class="ca-btn ca-seed" title="Random seed">${svg("seed")}</button>
        <button class="ca-btn ca-clear" title="Clear">${svg("clear")}</button>
        <button class="ca-pill ca-speed" title="Speed">${svg("speed")}<b></b></button>
      </div>`;
    const q = (s) => el.querySelector(s);
    const stage = q(".ca-stage"), canvas = q("canvas"), toast = q(".ca-toast"), menu = q(".ca-menu"), picker = q(".ca-picker");
    const status = q(".ca-status"), rulePill = q(".ca-rule"), speedPill = q(".ca-speed"), playBtn = q(".ca-play");

    // ---- engine
    let engine;
    if (o.engine !== "cpu") { try { engine = new GLEngine(canvas); } catch (e) { console.warn("[ca] WebGL2 failed, using CPU engine:", e.message); } }
    if (!engine) { if (o.engine === "gpu") throw new Error("WebGL2 unavailable"); engine = new CPUEngine(canvas); }

    const st = {
      rule: null, gps: 15, playing: !!o.autoplay, gen: 0, pop: 0, cells: 1, acc: 0, last: 0,
      hashes: [], stale: 0, lastTouch: performance.now(), attractOn: false, sceneAt: performance.now(),
      cpuFactor: 1, agents: new Map(), lastMeasure: 0, dirty: true, dpr: 1, themeCss: !o.theme, destroyed: false,
    };
    const theme = { young: [0, 0, 1], old: [1, 0, 0], dying: [0.7, 0.2, 1] };
    const readBuf = { buf: null };

    function setTheme(t) {
      if (!t) {
        const cs = getComputedStyle(el);
        t = { primary: cs.getPropertyValue("--accent") || DEFAULT_THEME.primary, secondary: cs.getPropertyValue("--accent-2") || DEFAULT_THEME.secondary, blend: cs.getPropertyValue("--accent-3") || DEFAULT_THEME.blend };
        st.themeCss = true;
      } else st.themeCss = false;
      theme.old = parseColor(t.primary, theme.old);
      theme.young = parseColor(t.secondary, theme.young);
      theme.dying = parseColor(t.blend, theme.dying);
      st.dirty = true;
    }
    setTheme(o.theme);

    // ---- grid sizing
    function gridSize() {
      if (o.size) return [o.size.w, o.size.h];
      // Layout size, not getBoundingClientRect: the dev page scales the frame with a transform.
      const w = stage.clientWidth - 2, h = stage.clientHeight - 2; // minus the 1px border
      st.dpr = window.devicePixelRatio || 1;
      return [Math.max(8, Math.floor((w * st.dpr) / o.cell)), Math.max(8, Math.floor((h * st.dpr) / o.cell))];
    }
    function fitCanvas(W, H) {
      canvas.width = W * o.cell; canvas.height = H * o.cell;
      if (!o.size) { canvas.style.width = `${canvas.width / st.dpr}px`; canvas.style.height = `${canvas.height / st.dpr}px`; }
    }

    // ---- world ops
    function seed(reason) {
      const [W, H] = gridSize();
      fitCanvas(W, H);
      const buf = Core.seedGrid(st.rule, W, H);
      if (engine.W !== W || engine.H !== H) engine.resize(W, H, buf); else engine.load(buf);
      st.gen = 0; st.acc = 0; st.hashes = []; st.stale = 0; st.sceneAt = performance.now(); st.dirty = true;
      if (reason !== "silent") flash(`${st.rule.name}`, st.rule.rule || (st.rule.wolfram ? `rule ${st.rule.wolfram}` : `${st.rule.states} states`));
    }
    function clear() {
      const [W, H] = gridSize();
      fitCanvas(W, H);
      const buf = new Uint8Array(W * H * 4);
      if (engine.W !== W || engine.H !== H) engine.resize(W, H, buf); else engine.load(buf);
      st.gen = 0; st.hashes = []; st.stale = 0; st.dirty = true;
    }
    function setRule(idOrRule, opt = {}) {
      const base = typeof idOrRule === "string" ? Core.RULES.find((r) => r.id === idOrRule) : idOrRule;
      if (!base) throw new Error(`unknown rule ${idOrRule}`);
      st.rule = Core.resolve(base);
      engine.setRule(st.rule);
      if (!opt.keepSpeed) st.gps = o.speed || st.rule.speed;
      rulePill.querySelector("b").textContent = st.rule.name;
      rulePill.querySelector("small").textContent = st.rule.rule || (st.rule.family === FAMILY.ELEMENTARY ? `rule ${st.rule.wolfram}` : `${st.rule.states} states · T${st.rule.threshold}`);
      speedPill.querySelector("b").textContent = `${st.gps}/s`;
      if (!opt.keepWorld) seed(opt.silent ? "silent" : "rule");
      st.dirty = true;
    }
    function randomRule() {
      // Random Life-like rule biased toward interesting ones: always B3 or B2, never B0/B1.
      let birth = (Math.random() < 0.7 ? 1 << 3 : 1 << 2);
      for (let n = 4; n <= 8; n++) if (Math.random() < 0.3) birth |= 1 << n;
      let survive = 0;
      for (let n = 0; n <= 8; n++) if (Math.random() < 0.45) survive |= 1 << n;
      const digits = (m) => [...Array(9).keys()].filter((n) => (m >> n) & 1).join("");
      const rule = `B${digits(birth)}/S${digits(survive)}`;
      return { id: `random:${rule}`, name: "Random", rule, density: 0.3 + Math.random() * 0.2, speed: 15 };
    }
    function setSpeed(gps) { st.gps = gps; speedPill.querySelector("b").textContent = `${gps}/s`; }
    function play() { st.playing = true; playBtn.innerHTML = svg("pause"); st.last = 0; }
    function pause() { st.playing = false; playBtn.innerHTML = svg("play"); updateStatus(); }
    function stepOnce() { pause(); engine.step(1); st.gen++; st.dirty = true; }

    // ---- painting
    const brushRadius = () => Math.max(1, Math.round((5 * st.dpr) / o.cell));
    function toGrid(ev) {
      const r = canvas.getBoundingClientRect();
      const gx = Math.floor(((ev.clientX - r.left) / r.width) * engine.W);
      const gy = Math.floor((1 - (ev.clientY - r.top) / r.height) * engine.H);
      return [gx, gy];
    }
    function block(w, h, state) { const b = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) b[i * 4] = state; return b; }
    function dot(gx, gy, state) {
      const r = brushRadius(), d = 2 * r + 1;
      const s = state === undefined ? 1 : state;
      if (st.rule.family === FAMILY.ELEMENTARY) { engine.paint(gx - r, 0, d, 1, block(d, 1, s)); return; }
      engine.paint(gx - r, gy - r, d, d, block(d, d, s));
      st.dirty = true;
    }
    function line(a, b, state) {
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, brushRadius())));
      for (let i = 0; i <= n; i++) dot(Math.round(a[0] + (dx * i) / n), Math.round(a[1] + (dy * i) / n), state);
    }
    function stamp(pattern, gx, gy) {
      const rows = pattern.rows, h = rows.length, w = Math.max(...rows.map((r) => r.length));
      const b = new Uint8Array(w * h * 4);
      rows.forEach((row, ry) => { const y = h - 1 - ry; for (let x = 0; x < row.length; x++) if (row[x] === "O") b[(y * w + x) * 4] = 1; });
      engine.paint(gx - (w >> 1), gy - (h >> 1), w, h, b);
      st.dirty = true;
    }
    function inject(count, rowFromTop) {
      const b = block(1, 1, 1);
      for (let i = 0; i < count; i++) {
        const gx = Math.floor(Math.random() * engine.W);
        const gy = st.rule.family === FAMILY.ELEMENTARY ? 0 : rowFromTop ? engine.H - 1 - Math.floor(Math.random() * 3) : Math.floor(Math.random() * engine.H);
        engine.paint(gx, gy, 1, 1, b);
      }
      st.dirty = true;
    }

    const pointers = new Map();
    let pressTimer = null;
    function touched() { st.lastTouch = performance.now(); if (st.attractOn) { st.attractOn = false; } }
    canvas.addEventListener("pointerdown", (ev) => {
      touched(); hidePicker(); hideMenu();
      const g = toGrid(ev);
      pointers.set(ev.pointerId, { last: g, start: g, moved: false, x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture(ev.pointerId);
      if (pointers.size === 1 && st.rule.family !== FAMILY.CYCLIC) {
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { const p = pointers.get(ev.pointerId); if (p && !p.moved) { p.menu = true; showMenu(ev.clientX, ev.clientY, g); } }, 450);
      }
    });
    canvas.addEventListener("pointermove", (ev) => {
      const p = pointers.get(ev.pointerId); if (!p || p.menu) return;
      if (!p.moved && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 6) return;
      if (!p.moved) { p.moved = true; clearTimeout(pressTimer); }
      const g = toGrid(ev);
      line(p.last, g, st.rule.family === FAMILY.CYCLIC ? Math.floor(Math.random() * st.rule.states) : 1);
      p.last = g; touched();
    });
    const up = (ev) => {
      const p = pointers.get(ev.pointerId); if (!p) return;
      clearTimeout(pressTimer);
      if (!p.moved && !p.menu) dot(p.start[0], p.start[1], st.rule.family === FAMILY.CYCLIC ? Math.floor(Math.random() * st.rule.states) : 1);
      pointers.delete(ev.pointerId);
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    // ---- stamp menu
    function showMenu(cx, cy, g) {
      menu.innerHTML = Core.STAMPS.map((s, i) => `<button data-i="${i}">${s.name}</button>`).join("");
      menu.hidden = false;
      const r = stage.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = `${Math.min(Math.max(8, cx - r.left - mw / 2), r.width - mw - 8)}px`;
      menu.style.top = `${Math.min(Math.max(8, cy - r.top - mh - 24), r.height - mh - 8)}px`;
      menu.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; stamp(Core.STAMPS[+b.dataset.i], g[0], g[1]); hideMenu(); touched(); };
    }
    function hideMenu() { menu.hidden = true; }

    // ---- rule picker
    function showPicker() {
      picker.innerHTML = `<div class="ca-picker-list">${Core.RULES.map((r) => `<button data-id="${r.id}" class="${st.rule.id === r.id ? "on" : ""}"><b>${r.name}</b><small>${r.rule || (r.wolfram ? "rule " + r.wolfram : r.states + " states")}</small><span>${r.blurb}</span></button>`).join("")}<button data-id="random"><b>Random rule</b><small>B?/S?</small><span>A fresh Life-like rule every tap. Most are boring. Some are not.</span></button></div>`;
      picker.hidden = false;
      picker.onclick = (ev) => {
        const b = ev.target.closest("button"); if (!b) return;
        touched();
        setRule(b.dataset.id === "random" ? randomRule() : b.dataset.id);
        hidePicker();
      };
    }
    function hidePicker() { picker.hidden = true; }

    rulePill.addEventListener("click", () => { touched(); hideMenu(); picker.hidden ? showPicker() : hidePicker(); });
    playBtn.addEventListener("click", () => { touched(); st.playing ? pause() : play(); });
    q(".ca-step").addEventListener("click", () => { touched(); stepOnce(); });
    q(".ca-seed").addEventListener("click", () => { touched(); seed(); });
    q(".ca-clear").addEventListener("click", () => { touched(); clear(); });
    speedPill.addEventListener("click", () => { touched(); const i = SPEEDS.indexOf(st.gps); setSpeed(SPEEDS[(i + 1) % SPEEDS.length] || SPEEDS[0]); });

    // ---- toast
    let toastTimer = null;
    function flash(title, sub) {
      toast.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ""}`;
      toast.hidden = false; toast.classList.remove("out");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.classList.add("out"); setTimeout(() => (toast.hidden = true), 600); }, 1800);
    }

    // ---- status + liveness
    function updateStatus() {
      if (!status) return;
      const pct = ((st.pop / st.cells) * 100).toFixed(st.pop / st.cells < 0.1 ? 1 : 0);
      status.textContent = `${st.playing ? "" : "paused · "}gen ${st.gen.toLocaleString()} · ${pct}% · ${engine.kind}${st.attractOn ? " · auto" : ""}`;
    }
    function measure(now) {
      st.lastMeasure = now;
      readBuf.buf = engine.read(readBuf.buf && readBuf.buf.length === engine.W * engine.H * 4 ? readBuf.buf : null);
      const m = Core.measure(st.rule, readBuf.buf, engine.W, engine.H);
      st.pop = m.pop; st.cells = m.cells;
      const repeat = st.hashes.includes(m.hash);
      st.hashes.push(m.hash); if (st.hashes.length > 8) st.hashes.shift();
      st.stale = m.pop === 0 || repeat ? st.stale + 1 : 0;
      updateStatus();
    }

    // ---- attract mode
    const attractRules = Core.RULES.filter((r) => r.attract);
    function nextScene() {
      const others = attractRules.filter((r) => r.id !== st.rule.id);
      const pick = Math.random() < 0.12 ? randomRule() : others[Math.floor(Math.random() * others.length)];
      setRule(pick);
      if (!st.playing) play();
    }
    function attractTick(now) {
      if (!o.attract) return;
      const idle = (now - st.lastTouch) / 1000;
      if (!st.attractOn && idle > o.attract.idle) { st.attractOn = true; st.sceneAt = now; hidePicker(); hideMenu(); }
      if (!st.attractOn) return;
      const sceneAge = (now - st.sceneAt) / 1000;
      if ((st.stale >= 3 && sceneAge > 6) || sceneAge > o.attract.rotate) nextScene();
    }

    // ---- reactive hooks (hardware snapshot from the panel)
    function onSnapshot(snap) {
      if (!o.reactive || !snap) return;
      if (snap.cpu && snap.cpu.percent != null) st.cpuFactor = 0.6 + (Math.min(100, snap.cpu.percent) / 100) * 1.6;
      if (snap.network && snap.network.down_bps != null && st.playing) {
        const n = Math.min(40, Math.floor((snap.network.down_bps + (snap.network.up_bps || 0)) / 40000));
        if (n > 0) inject(n, true);
      }
      if (Array.isArray(snap.agents) && (st.rule.family === FAMILY.LIFE || st.rule.family === FAMILY.GENERATIONS)) {
        for (const a of snap.agents) {
          const prev = st.agents.get(a.id);
          if (prev !== undefined && prev !== a.status) stamp(Core.STAMPS[0], Math.floor(Math.random() * engine.W), Math.floor(Math.random() * engine.H));
          st.agents.set(a.id, a.status);
        }
      }
    }

    // ---- main loop
    function frame(now) {
      if (st.destroyed) return;
      requestAnimationFrame(frame);
      if (st.playing) {
        if (!st.last) st.last = now;
        const dt = Math.min(0.25, (now - st.last) / 1000);
        st.last = now;
        st.acc += dt * st.gps * (st.attractOn ? st.cpuFactor : 1);
        const n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(st.acc));
        if (n > 0) { st.acc -= n; engine.step(n); st.gen += n; st.dirty = true; }
      }
      if (now - st.lastMeasure > 1000) { measure(now); attractTick(now); if (st.themeCss) setTheme(null); }
      if (st.dirty && now - (st.lastRender || 0) >= 1000 / RENDER_FPS) { engine.render(theme); st.dirty = false; st.lastRender = now; }
    }

    // ---- resize handling
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
      if (o.size) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { const [W, H] = gridSize(); if (W !== engine.W || H !== engine.H) seed("silent"); }, 150);
    });
    ro.observe(stage);
    canvas.addEventListener("webglcontextlost", (ev) => { ev.preventDefault(); pause(); });
    canvas.addEventListener("webglcontextrestored", () => { engine = new GLEngine(canvas); setRule(st.rule, { keepSpeed: true }); play(); });
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());

    // ---- go
    setRule(o.rule, { silent: true });
    if (!st.playing) pause();
    requestAnimationFrame(frame);

    return {
      el, get engine() { return engine; }, get rule() { return st.rule; }, get gen() { return st.gen; }, get state() { return st; },
      setTheme, setRule, randomRule, setSpeed, play, pause, toggle: () => (st.playing ? pause() : play()),
      step: stepOnce, seed, clear, stamp, inject, onSnapshot, read: () => engine.read(),
      setPaused(hidden) { if (hidden) { st.wasPlaying = st.playing; pause(); } else if (st.wasPlaying) play(); },
      destroy() { st.destroyed = true; ro.disconnect(); engine.destroy(); el.innerHTML = ""; el.classList.remove("ca"); },
    };
  }

  root.CA = { mount, GLEngine, CPUEngine, SPEEDS, RULES: Core.RULES, STAMPS: Core.STAMPS, parseColor };
})(window);
