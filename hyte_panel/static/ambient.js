/* Continuous liquid-metal light behind the glass. A small WebGL surface is
   upscaled by the compositor: no CPU pixel uploads or full-screen CSS blur.
   Colors follow the case lighting through HyteAmbient.setPalette(). */
(function () {
  "use strict";

  const canvas = document.querySelector(".ambient-glow canvas");
  if (!canvas) { window.HyteAmbient = { setPalette() {} }; return; }
  const host = canvas.parentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const styles = getComputedStyle(document.documentElement);
  const probe = document.createElement("span");
  let target = [], palette = [];

  function rgb(value) {
    probe.style.color = value;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const channels = resolved.match(/[\d.]+/g) || [0, 0, 0];
    const divisor = resolved.startsWith("color(") ? 1 : 255;
    return channels.slice(0, 3).map((c) => Number(c) / divisor);
  }
  function setPalette(primary, secondary) {
    target = [rgb(primary), rgb(secondary)];
    // Keep an opaque color field available if WebGL is unavailable or lost.
    const css = target.map((c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`);
    host.style.background = `linear-gradient(155deg, ${css[0]}, ${css[1]} 48%, ${css[0]})`;
    if (!palette.length || motion.matches) palette = target.map((c) => c.slice());
  }
  setPalette(styles.getPropertyValue("--accent").trim() || "#ff2d3f",
             styles.getPropertyValue("--accent-2").trim() || "#3d7bff");

  let gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false,
    });
  } catch (error) { /* Keep the CSS color field if GPU access is disabled. */ }
  let program, buffer, uniforms;
  let ready = false, raf = 0, last = null, time = Math.random() * 100;
  const vertex = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
  `;
  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 resolution;
    uniform float time;
    uniform vec3 primary;
    uniform vec3 secondary;

    // Nested waves advect the surface continuously; there are no discrete
    // states to crossfade, births/deaths, or easing stops between ticks.
    float surface(vec2 p) {
      vec2 q = p + vec2(
        0.72 * sin(p.y * 1.6 + time * 0.31) + 0.30 * cos(p.x * 2.1 - time * 0.23),
        0.62 * sin(p.x * 1.8 - time * 0.27) + 0.28 * cos(p.y * 1.3 + time * 0.19)
      );
      return sin(q.x * 2.6 + q.y * 1.1 + time * 0.22)
           + 0.55 * sin(q.y * 2.7 - q.x * 0.8 - time * 0.18)
           + 0.22 * cos(q.x * 4.1 + q.y * 2.3 + time * 0.13);
    }
    void main() {
      vec2 p = (gl_FragCoord.xy - 0.5 * resolution) / min(resolution.x, resolution.y) * 2.5;
      float h = surface(p);
      float dx = (surface(p + vec2(0.018, 0.0)) - h) / 0.018;
      float dy = (surface(p + vec2(0.0, 0.018)) - h) / 0.018;
      vec3 normal = normalize(vec3(-dx * 0.48, -dy * 0.48, 1.0));
      vec3 light = normalize(vec3(-0.5, 0.65, 1.0));
      float diffuse = max(dot(normal, light), 0.0);
      float blend = smoothstep(-0.65, 0.65, h);
      vec3 base = mix(primary, secondary, blend);
      // Broad reflected light with a narrower silver sheen on curved folds.
      float reflection = pow(max(dot(normal, normalize(vec3(-0.35, 0.3, 1.0))), 0.0), 18.0);
      float ribbon = exp(-pow((h + 0.10) * 7.0, 2.0));
      vec3 color = base * (0.30 + 0.30 * diffuse);
      color += mix(base, vec3(0.78, 0.84, 0.95), 0.65) * (0.30 * reflection + 0.16 * ribbon);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("Ambient shader compilation failed");
    }
    return shader;
  }
  function initialize() {
    if (!gl) return;
    const shaders = [];
    try {
      shaders.push(compile(gl.VERTEX_SHADER, vertex));
      shaders.push(compile(gl.FRAGMENT_SHADER, fragment));
      program = gl.createProgram();
      shaders.forEach((shader) => gl.attachShader(program, shader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Ambient shader link failed");
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(["resolution", "time", "primary", "secondary"]
        .map((key) => [key, gl.getUniformLocation(program, key)]));
      ready = true;
      canvas.style.visibility = "visible";
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      canvas.style.visibility = "hidden";
      ready = false;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }
  function resize() {
    // Cap work independently of physical screen size / device pixel ratio.
    // This soft surface needs far fewer pixels than the text above it.
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const scale = Math.min(1, 960 / Math.max(width, height), Math.sqrt(240000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    if (ready) gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }
  function draw() {
    if (!ready) return;
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, time);
    gl.uniform3fv(uniforms.primary, palette[0]);
    gl.uniform3fv(uniforms.secondary, palette[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    raf = 0;
    if (!ready || document.hidden || motion.matches) { last = null; return; }
    const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    // All wave rates are integer hundredths: this shared period wraps
    // seamlessly and preserves float precision during multi-day kiosk runs.
    time = (time + dt) % (Math.PI * 200);
    const blend = 1 - Math.exp(-dt * 3);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < 3; i++) palette[c][i] += (target[c][i] - palette[c][i]) * blend;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function syncMotion() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = null;
    if (motion.matches) palette = target.map((c) => c.slice());
    if (!document.hidden) {
      draw();
      if (ready && !motion.matches) raf = requestAnimationFrame(frame);
    }
  }
  window.HyteAmbient = {
    setPalette(primary, secondary) {
      setPalette(primary, secondary);
      if (motion.matches) draw();
    },
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    ready = false;
    canvas.style.visibility = "hidden";
    syncMotion();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    initialize();
    resize();
    syncMotion();
  });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", syncMotion);
  motion.addEventListener("change", syncMotion);
  initialize();
  if (!gl) canvas.style.visibility = "hidden";
  resize();
  syncMotion();
})();
