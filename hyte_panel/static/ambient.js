/* Continuous ambient ground behind the glass. A small WebGL surface is
   upscaled by the compositor: no CPU pixel uploads or full-screen CSS blur.
   DESIGNS holds every selectable background (theme.background in the config;
   ids also listed in config.py BACKGROUNDS). Colors follow the case lighting
   through HyteAmbient.setPalette(); the settings page draws live previews
   with HyteAmbient.preview(). Every design is a function of trig terms in
   `time` with rates in integer thousandths, so the clock can wrap at 2000*pi
   seconds without a visible cut and floats stay precise on multi-day runs. */
(function () {
  "use strict";

  const PERIOD = Math.PI * 2000;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const probe = document.createElement("span");

  function rgb(value) {
    probe.style.color = value;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const channels = resolved.match(/[\d.]+/g) || [0, 0, 0];
    const divisor = resolved.startsWith("color(") ? 1 : 255;
    return channels.slice(0, 3).map((c) => Number(c) / divisor);
  }

  const PRELUDE = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 resolution;
    uniform float time;
    uniform vec3 primary;
    uniform vec3 secondary;
    uniform vec3 page;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 7.31)); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }
    // Width-normalized coordinates: x spans [-0.5, 0.5], so a design looks
    // the same on the panel and in a preview of any height.
    vec2 coords() { return (gl_FragCoord.xy - 0.5 * resolution) / resolution.x; }
    float aspect() { return resolution.y / resolution.x; }
  `;

  const DESIGNS = [
    {
      id: "liquid", name: "Liquid metal",
      blurb: "Folded chrome in the two accents, lit from the top left, flowing upward.",
      frag: `
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
          // Steady advection keeps the metal moving forward while folds evolve.
          // 0.20 preserves the shared period of the rational wave frequencies.
          p.y += time * 0.20;
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
        }`,
    },
    {
      id: "ribbons", name: "Aero ribbons",
      blurb: "Slanted light ribbons with white cores, alternating accents.",
      frag: `
        void main() {
          vec2 p = coords(); float t = time;
          vec3 col = page * 0.9 + mix(primary, secondary, 0.5) * 0.06 * fbm(p * 2.5 + vec2(0.3 * sin(t * 0.013), 0.5 * sin(t * 0.009)));
          float period = 1.25;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float off = fi * period / 4.0 + 0.2 * sin(t * 0.011 + fi);
            float xc = off + 0.42 * p.y + 0.16 * sin(p.y * 1.9 + t * 0.19 + fi * 1.7) + 0.07 * sin(p.y * 4.3 - t * 0.14 + fi * 0.8);
            float w = 0.05 + 0.03 * sin(p.y * 1.3 + t * 0.11 + fi * 2.0);
            float d = p.x - xc; d = mod(d + 0.5 * period, period) - 0.5 * period;
            float band = exp(-d * d / (w * w));
            float core = exp(-d * d / (w * w * 0.05));
            vec3 tint = mod(fi, 2.0) < 1.0 ? primary : secondary;
            float pulse = 0.55 + 0.45 * sin(t * 0.27 + fi * 2.1 + p.y * 1.4);
            col += tint * band * 0.42 * pulse + mix(tint, vec3(1.0), 0.7) * core * 0.30 * pulse;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "bokeh", name: "Bokeh glass",
      blurb: "Out-of-focus discs in three depths, drifting and breathing.",
      frag: `
        vec3 layer(vec2 p, float scale, float r1, float r2, float blur, float seed) {
          vec2 g = p * scale + vec2(seed + 0.5 * sin(time * r2), -(1.2 * sin(time * r1) + 0.8 * sin(time * r2 + 1.0)));
          vec2 id = floor(g), f = fract(g) - 0.5; vec3 acc = vec3(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j)); vec2 cell = id + o;
            vec2 h = hash2(cell);
            vec2 c = o + (h - 0.5) * 0.9 + 0.08 * vec2(sin(time * 0.4 + h.x * 6.28), cos(time * 0.3 + h.y * 6.28));
            float r = 0.16 + 0.24 * hash(cell + 3.1);
            float d = length(f - c);
            float disc = smoothstep(r, r - blur, d);
            float rim = disc * smoothstep(r - blur * 1.8, r - blur * 0.6, d);
            float tw = 0.5 + 0.5 * sin(time * 0.6 + hash(cell + 9.0) * 6.28);
            vec3 tint = mix(primary, secondary, hash(cell + 5.7));
            acc += tint * (disc * 0.26 + rim * 0.34) * (0.4 + 0.6 * tw);
          }
          return acc;
        }
        void main() {
          vec2 p = coords();
          float g = smoothstep(-0.5 * aspect(), 0.5 * aspect(), p.y);
          vec3 col = page * 0.85 + mix(primary, secondary, g) * 0.07;
          col += layer(p, 2.2, 0.021, 0.013, 0.10, 1.0);
          col += layer(p, 4.5, 0.029, 0.017, 0.05, 2.0) * 0.7;
          col += layer(p, 9.0, 0.041, 0.023, 0.03, 3.0) * 0.45;
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "caustics", name: "Pool caustics",
      blurb: "Sunlight refracted through a water surface, accents in the water between.",
      frag: `
        float caustic(vec2 p, vec4 rates) {
          vec2 i = p; float c = 0.0; float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float rate = n == 0 ? rates.x : n == 1 ? rates.y : n == 2 ? rates.z : rates.w;
            float tt = 23.0 + time * rate;
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0; c = 1.17 - pow(c, 1.4);
          return min(pow(abs(c), 8.0), 1.0);
        }
        void main() {
          vec2 p = coords();
          vec2 q = p * 7.0;
          // Mirror-tile the field: the classic caustic sum only behaves in a
          // bounded window, and the large offset keeps its terms small.
          vec2 m = abs(mod(q, 12.566) - 6.283) + 250.0;
          float c = caustic(m, vec4(-0.875, -0.26, -0.06, 0.045));
          float c2 = caustic(abs(mod(q * 0.7 + 1.3, 12.566) - 6.283) + 250.0, vec4(-0.7, -0.21, -0.048, 0.036));
          float g = smoothstep(-0.5 * aspect(), 0.5 * aspect(), p.y);
          vec3 water = mix(primary, secondary, g);
          vec3 col = water * 0.30 + page * 0.55;
          col += water * c * 0.5 + vec3(0.85, 0.92, 1.0) * (c * 0.22 + c2 * 0.12);
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "ink", name: "Ink marble",
      blurb: "Two inks folded by a slow current. Pigment, no lighting.",
      frag: `
        void main() {
          vec2 p = coords() * 3.2;
          p.y += 1.2 * sin(time * 0.011) + 0.7 * sin(time * 0.007);
          vec2 d1 = 0.8 * vec2(sin(time * 0.021), cos(time * 0.017));
          vec2 d2 = 0.6 * vec2(sin(time * 0.013 + 2.0), cos(time * 0.019 + 1.0));
          vec2 q = vec2(fbm(p + d1), fbm(p + vec2(5.2, 1.3) - d2));
          vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + d2), fbm(p + 4.0 * q + vec2(8.3, 2.8) - d1));
          float f = fbm(p + 4.0 * r);
          vec3 base = mix(primary, secondary, clamp(f * f * 4.0, 0.0, 1.0));
          vec3 col = mix(base, page * 0.9, clamp(length(q), 0.0, 1.0));
          col = mix(col, vec3(0.82, 0.86, 1.0), clamp(r.x, 0.0, 1.0) * 0.45);
          col *= (f * f * f + 0.6 * f * f + 0.5 * f) * 1.35;
          col = max(col, page * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "satin", name: "Satin curtain",
      blurb: "Vertical folds with a sheen that runs across the threads.",
      frag: `
        float cloth(vec2 q) {
          return sin(q.x * 5.0 + 1.6 * sin(q.y * 0.7 + time * 0.17) + 0.8 * sin(q.y * 1.9 - time * 0.11))
               + 0.35 * sin(q.x * 11.0 - q.y * 0.6 + time * 0.13);
        }
        void main() {
          vec2 p = coords(); vec2 q = p * 2.0;
          q.y += 1.5 * sin(time * 0.023) + 0.8 * sin(time * 0.014);
          q.x += 0.12 * fbm(q * 0.8 + vec2(0.6 * sin(time * 0.03), 0.6 * cos(time * 0.021)));
          float h = cloth(q); float e = 0.01;
          float dx = (cloth(q + vec2(e, 0.0)) - h) / e, dy = (cloth(q + vec2(0.0, e)) - h) / e;
          vec3 n = normalize(vec3(-dx * 0.22, -dy * 0.22, 1.0));
          vec3 L = normalize(vec3(-0.4, 0.5, 0.75));
          float diff = max(dot(n, L), 0.0);
          vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
          vec3 T = normalize(vec3(0.0, 1.0, 0.0) - n * n.y);
          float th = dot(T, H);
          float spec = pow(sqrt(max(1.0 - th * th, 0.0)), 90.0);
          float fiber = 0.85 + 0.15 * noise(vec2(q.x * 90.0, q.y * 4.0));
          float band = 0.5 + 0.5 * sin(q.x * 0.9 + q.y * 0.4 + time * 0.05);
          vec3 base = mix(primary, secondary, band) * 0.6;
          vec3 col = base * (0.22 + 0.6 * diff) * fiber + mix(base, vec3(0.95, 0.95, 1.0), 0.6) * spec * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "coral", name: "Turing coral",
      blurb: "A reaction-diffusion field that grows, splits and dies. The automaton's heir.",
      sim: true,
    },
    {
      id: "lava", name: "Lava lamp",
      blurb: "Glossy blobs in the two accents rising, sinking and merging.",
      frag: `
        void balls(vec2 p, out float fa, out float fb) {
          fa = 0.0; fb = 0.0; float span = aspect() * 0.5 + 0.35;
          for (int i = 0; i < 7; i++) {
            float fi = float(i);
            float r = 0.06 + 0.07 * hash(vec2(fi, 1.1));
            float speed = 0.001 * (45.0 + floor(hash(vec2(fi, 2.2)) * 40.0));
            float y = span * sin(time * speed + hash(vec2(fi, 3.7)) * 6.28);
            float x = (hash(vec2(fi, 4.4)) - 0.5) * 0.72 + 0.12 * sin(time * 0.23 + fi * 1.9);
            vec2 d = p - vec2(x, y);
            float f = r * r / (dot(d, d) + 0.0005);
            if (mod(fi, 2.0) < 1.0) fa += f; else fb += f;
          }
        }
        float dome(float f) { return sqrt(max(1.0 - 1.0 / max(f, 0.0001), 0.0)); }
        void main() {
          vec2 p = coords(); float fa, fb, fa1, fb1, fa2, fb2; float e = 0.004;
          balls(p, fa, fb); balls(p + vec2(e, 0.0), fa1, fb1); balls(p + vec2(0.0, e), fa2, fb2);
          float f = fa + fb; float z = dome(f);
          float gx = (dome(fa1 + fb1) - z) / e, gy = (dome(fa2 + fb2) - z) / e;
          vec3 n = normalize(vec3(-gx * 0.08, -gy * 0.08, 1.0));
          float inside = smoothstep(0.92, 1.08, f);
          vec3 tint = mix(primary, secondary, fb / (fa + fb + 0.0001));
          vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
          float diff = max(dot(n, L), 0.0);
          float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
          float fres = pow(1.0 - n.z, 2.0);
          vec3 blob = tint * (0.4 + 0.5 * diff) + vec3(1.0) * spec * 0.55 + mix(tint, vec3(1.0), 0.5) * fres * 0.5;
          vec3 ground = page * 0.85 + tint * min(f, 1.0) * 0.22;
          gl_FragColor = vec4(mix(ground, blob, inside), 1.0);
        }`,
    },
    {
      id: "shafts", name: "Light shafts",
      blurb: "Beams raking down from the top left, accents split at their edges, dust in the light.",
      frag: `
        float shaft(float ang) {
          float v = fbm(vec2(ang * 6.0 + 0.9 * sin(time * 0.03), 0.7 * sin(time * 0.02)));
          v = smoothstep(0.30, 0.70, v);
          float w = noise(vec2(ang * 30.0 - 0.8 * sin(time * 0.02), 3.3));
          return v * (0.55 + 0.45 * w);
        }
        float dust(vec2 p) {
          vec2 g = p * 14.0 + vec2(0.4 * sin(time * 0.017), -(1.1 * sin(time * 0.019) + 0.7 * sin(time * 0.011)));
          vec2 id = floor(g), f = fract(g) - 0.5; vec2 h = hash2(id);
          vec2 c = (h - 0.5) * 0.8 + 0.1 * vec2(sin(time * 0.5 + h.x * 6.28), cos(time * 0.4 + h.y * 6.28));
          float d = length(f - c);
          float tw = 0.5 + 0.5 * sin(time * 0.8 + h.y * 6.28);
          return smoothstep(0.05, 0.0, d) * tw * step(0.55, hash(id + 2.2));
        }
        void main() {
          vec2 p = coords(); float a = aspect();
          vec2 src = vec2(-0.6, a * 0.5 + 0.4);
          vec2 d = p - src; float ang = atan(d.x, -d.y); float dist = length(d);
          float fall = exp(-dist * 0.5) * smoothstep(0.0, 0.5, dist);
          float sP = shaft(ang + 0.03), sS = shaft(ang - 0.03), sM = shaft(ang);
          vec3 col = page * 0.85;
          col += primary * sP * fall * 0.8 + secondary * sS * fall * 0.8 + vec3(0.9, 0.92, 1.0) * sM * fall * 0.35;
          col += mix(primary, secondary, 0.5) * 0.22 * exp(-dist * 0.9);
          col += vec3(0.95, 0.96, 1.0) * dust(p) * (0.25 + 0.6 * sM * fall);
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "contours", name: "Contour drift",
      blurb: "A topographic map that never holds still; every fourth line is an index contour.",
      frag: `
        void main() {
          vec2 p = coords() * 2.4;
          p.y += 0.9 * sin(time * 0.011) + 0.5 * sin(time * 0.007);
          vec2 warp = 0.35 * vec2(fbm(p * 0.7 + vec2(0.8 * sin(time * 0.04), 0.8 * cos(time * 0.031))),
                                  fbm(p * 0.7 - vec2(0.8 * cos(time * 0.03), 0.8 * sin(time * 0.023))));
          float h = fbm(p + warp);
          float levels = 14.0; float v = h * levels;
          float band = floor(v); float fr = fract(v);
          float line = 1.0 - smoothstep(0.0, 0.11, min(fr, 1.0 - fr));
          float index = step(mod(band, 4.0), 0.5);
          vec3 tint = mix(primary, secondary, smoothstep(0.3, 0.7, h));
          vec3 col = page * 0.9 + tint * 0.14 * (0.3 + 0.7 * smoothstep(0.2, 0.8, h)) * (0.6 + 0.4 * fr);
          col += tint * line * (0.55 + 0.6 * index) + vec3(1.0) * line * index * 0.22;
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
    {
      id: "hex", name: "Hex pulse",
      blurb: "A hexagonal lattice lit by a slow tide, with rings spreading from wandering points.",
      frag: `
        const vec2 S = vec2(1.0, 1.7320508);
        vec4 hexCoords(vec2 uv) {
          vec2 a = mod(uv, S) - S * 0.5; vec2 b = mod(uv - S * 0.5, S) - S * 0.5;
          vec2 g = dot(a, a) < dot(b, b) ? a : b;
          return vec4(g, uv - g);
        }
        float hexDist(vec2 p) { p = abs(p); return max(dot(p, S * 0.5), p.x); }
        void main() {
          vec2 p = coords(); float scale = 11.0;
          vec4 hc = hexCoords(p * scale);
          vec2 c = hc.zw / scale; float d = hexDist(hc.xy);
          float v = fbm(c * 1.6 + vec2(0.5 * sin(time * 0.017), 1.2 * sin(time * 0.023) + 0.8 * sin(time * 0.013)));
          float ring = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float rate = i == 0 ? 0.3 : i == 1 ? 0.24 : 0.19;
            vec2 o = vec2((hash(vec2(fi, 8.0)) - 0.5) * 0.8 + 0.1 * sin(time * 0.07 + fi),
                          (hash(vec2(fi, 2.0)) - 0.5) * aspect() + 0.15 * cos(time * 0.05 + fi * 2.0));
            // Rings only show while growing: the cosine's return half is dark.
            float ph = 0.5 - 0.5 * cos(time * rate + fi * 2.3);
            float growing = step(0.0, sin(time * rate + fi * 2.3));
            float dd = length(c - o);
            ring += exp(-pow((dd - ph * 1.7) * 14.0, 2.0)) * (1.0 - ph) * growing;
          }
          float lit = smoothstep(0.35, 0.75, v);
          float cell = 1.0 - smoothstep(0.42, 0.5, d);
          vec3 tint = mix(primary, secondary, smoothstep(0.3, 0.7, v + 0.3 * ring));
          vec3 col = page * 0.85 + tint * 0.10;
          col += tint * (lit * 0.85 + ring * 1.1) * cell * (0.5 + 0.5 * (1.0 - d * 1.6));
          col += vec3(1.0) * ring * cell * 0.2;
          gl_FragColor = vec4(col, 1.0);
        }`,
    },
  ];
  const byId = (id) => DESIGNS.find((d) => d.id === id) || DESIGNS[0];

  // Gray-Scott reaction-diffusion for "coral": two ping-pong textures hold
  // (a, b); the display pass colors b and its gradient.
  const RD_INIT = `
    precision highp float;
    uniform vec2 grid;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / grid;
      float b = smoothstep(0.58, 0.7, noise(uv * vec2(12.0, 12.0 * grid.y / grid.x) + 3.1));
      gl_FragColor = vec4(1.0, b, 0.0, 1.0);
    }`;
  const RD_SIM = `
    precision highp float;
    uniform sampler2D state; uniform vec2 texel; uniform float time; uniform vec2 seed; uniform float seedOn;
    void main() {
      vec2 uv = gl_FragCoord.xy * texel;
      vec2 c = texture2D(state, uv).xy;
      vec2 lap = -c;
      lap += 0.2 * (texture2D(state, uv + vec2(texel.x, 0.0)).xy + texture2D(state, uv - vec2(texel.x, 0.0)).xy
                  + texture2D(state, uv + vec2(0.0, texel.y)).xy + texture2D(state, uv - vec2(0.0, texel.y)).xy);
      lap += 0.05 * (texture2D(state, uv + texel).xy + texture2D(state, uv - texel).xy
                   + texture2D(state, uv + vec2(texel.x, -texel.y)).xy + texture2D(state, uv - vec2(texel.x, -texel.y)).xy);
      // Feed and kill rates drift across the field so no region settles.
      float fy = 0.5 + 0.5 * sin(uv.y * 5.0 + time * 0.05 + sin(uv.x * 3.0 + time * 0.03));
      float fx = 0.5 + 0.5 * sin(uv.x * 4.0 - time * 0.04 + uv.y * 2.0);
      float feed = 0.028 + 0.034 * fy;
      float kill = 0.055 + 0.010 * fx;
      float abb = c.x * c.y * c.y;
      float a = c.x + (1.0 * lap.x - abb + feed * (1.0 - c.x));
      float b = c.y + (0.5 * lap.y + abb - (kill + feed) * c.y);
      vec2 asp = vec2(1.0, texel.x / texel.y);
      if (seedOn > 0.5 && distance(uv * asp, seed * asp) < 0.03) b = 1.0;
      gl_FragColor = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
    }`;
  const RD_SHOW = `
    precision highp float;
    uniform sampler2D state; uniform vec2 texel; uniform vec2 resolution;
    uniform vec3 primary; uniform vec3 secondary; uniform vec3 page;
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      float b = texture2D(state, uv).y;
      float bx = texture2D(state, uv + vec2(texel.x, 0.0)).y - texture2D(state, uv - vec2(texel.x, 0.0)).y;
      float by = texture2D(state, uv + vec2(0.0, texel.y)).y - texture2D(state, uv - vec2(0.0, texel.y)).y;
      float edge = clamp(length(vec2(bx, by)) * 3.0, 0.0, 1.0);
      vec3 col = mix(page * 0.85, primary * 0.8, smoothstep(0.05, 0.25, b));
      col = mix(col, secondary, smoothstep(0.2, 0.5, b) * 0.65);
      col += vec3(0.9, 0.93, 1.0) * edge * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const VERTEX = `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

  // A scene owns one canvas and GL context and renders one design at a time.
  // budget caps the pixel count: this soft surface needs far fewer pixels than
  // the text above it.
  function createScene(canvas, budget, designId) {
    let gl = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
      });
    } catch (error) { /* Keep the CSS color field if GPU access is disabled. */ }
    if (!gl) { canvas.style.visibility = "hidden"; return null; }

    const scene = { canvas, design: byId(designId), ready: false, time: Math.random() * 100, palette: null, target: null };
    let lost = false, buffer = null, show = null, sim = null, init = null, rd = null;

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Ambient shader compilation failed: ${log}`);
      }
      return shader;
    }
    function link(fragment, names) {
      const shaders = [];
      const program = gl.createProgram();
      try {
        shaders.push(compile(gl.VERTEX_SHADER, VERTEX));
        shaders.push(compile(gl.FRAGMENT_SHADER, fragment));
        shaders.forEach((shader) => gl.attachShader(program, shader));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Ambient shader link failed");
      } catch (error) {
        gl.deleteProgram(program);
        throw error;
      } finally {
        shaders.forEach((shader) => gl.deleteShader(shader));
      }
      const uniforms = Object.fromEntries(names.map((key) => [key, gl.getUniformLocation(program, key)]));
      return { program, uniforms };
    }
    function use({ program }) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    }
    function dropTargets() {
      if (!rd) return;
      [rd.ping, rd.pong].forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
      rd = null;
    }
    function teardown() {
      [show, sim, init].forEach((p) => { if (p) gl.deleteProgram(p.program); });
      show = sim = init = null;
      dropTargets();
      if (buffer) gl.deleteBuffer(buffer);
      buffer = null;
      scene.ready = false;
    }
    function build(design) {
      teardown();
      try {
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        if (design.sim) {
          show = link(RD_SHOW, ["state", "texel", "resolution", "primary", "secondary", "page"]);
          sim = link(RD_SIM, ["state", "texel", "time", "seed", "seedOn"]);
          init = link(RD_INIT, ["grid"]);
        } else {
          show = link(PRELUDE + design.frag, ["resolution", "time", "primary", "secondary", "page"]);
        }
        scene.ready = true;
        canvas.style.visibility = "visible";
      } catch (error) {
        console.warn(`ambient: ${design.id} unavailable`, error.message);
        teardown();
        if (design !== DESIGNS[0]) { scene.design = DESIGNS[0]; build(DESIGNS[0]); return; }
        canvas.style.visibility = "hidden";
      }
    }

    function makeTarget(w, h, type, linear) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (ok) return { tex, fbo };
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      return null;
    }
    function setupTargets() {
      const w = 144, h = Math.max(16, Math.min(720, Math.round(w * canvas.height / canvas.width)));
      if (rd && rd.w === w && rd.h === h) return;
      dropTargets();
      const half = gl.getExtension("OES_texture_half_float");
      const halfLinear = !!gl.getExtension("OES_texture_half_float_linear");
      const floatExt = gl.getExtension("OES_texture_float");
      const floatLinear = !!gl.getExtension("OES_texture_float_linear");
      const candidates = [];
      if (half) candidates.push({ type: half.HALF_FLOAT_OES, linear: halfLinear });
      if (floatExt) candidates.push({ type: gl.FLOAT, linear: floatLinear });
      candidates.push({ type: gl.UNSIGNED_BYTE, linear: true });
      for (const c of candidates) {
        const ping = makeTarget(w, h, c.type, c.linear);
        if (!ping) continue;
        const pong = makeTarget(w, h, c.type, c.linear);
        if (!pong) { gl.deleteTexture(ping.tex); gl.deleteFramebuffer(ping.fbo); continue; }
        rd = { w, h, ping, pong, seedIn: 2 };
        use(init);
        gl.uniform2f(init.uniforms.grid, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);
        gl.viewport(0, 0, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return;
      }
    }

    scene.resize = function () {
      const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
      const scale = Math.min(1, 960 / Math.max(width, height), Math.sqrt(budget / (width * height)));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      if (scene.ready && scene.design.sim) setupTargets();
    };
    scene.setDesign = function (id) {
      const design = byId(id);
      if (design === scene.design && scene.ready) return;
      scene.design = design;
      if (lost) return;
      build(design);
      if (scene.ready && design.sim) setupTargets();
    };
    // dt = 0 redraws the current state without advancing.
    scene.draw = function (dt) {
      if (!scene.ready || !scene.palette) return;
      scene.time = (scene.time + dt) % PERIOD;
      const blend = 1 - Math.exp(-dt * 3);
      for (let c = 0; c < 2; c++)
        for (let i = 0; i < 3; i++) scene.palette[c][i] += (scene.target[c][i] - scene.palette[c][i]) * blend;
      const W = canvas.width, H = canvas.height;
      if (scene.design.sim) {
        if (!rd) return;
        use(sim);
        gl.uniform2f(sim.uniforms.texel, 1 / rd.w, 1 / rd.h);
        gl.uniform1f(sim.uniforms.time, scene.time);
        gl.viewport(0, 0, rd.w, rd.h);
        // A fixed number of steps per frame keeps the growth rate readable;
        // an expensive frame does not fast-forward the chemistry.
        const steps = dt > 0 ? 6 : 0;
        for (let s = 0; s < steps; s++) {
          let seedOn = 0;
          rd.seedIn -= dt / steps;
          if (rd.seedIn <= 0) {
            seedOn = 1;
            rd.seedIn = 1.2 + Math.random() * 2.5;
            gl.uniform2f(sim.uniforms.seed, Math.random(), Math.random());
          }
          gl.uniform1f(sim.uniforms.seedOn, seedOn);
          gl.bindFramebuffer(gl.FRAMEBUFFER, rd.pong.fbo);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, rd.ping.tex);
          gl.uniform1i(sim.uniforms.state, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const t = rd.ping; rd.ping = rd.pong; rd.pong = t;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        use(show);
        gl.viewport(0, 0, W, H);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rd.ping.tex);
        gl.uniform1i(show.uniforms.state, 0);
        gl.uniform2f(show.uniforms.texel, 1 / rd.w, 1 / rd.h);
        gl.uniform2f(show.uniforms.resolution, W, H);
      } else {
        use(show);
        gl.viewport(0, 0, W, H);
        gl.uniform2f(show.uniforms.resolution, W, H);
        gl.uniform1f(show.uniforms.time, scene.time);
      }
      gl.uniform3fv(show.uniforms.primary, scene.palette[0]);
      gl.uniform3fv(show.uniforms.secondary, scene.palette[1]);
      gl.uniform3fv(show.uniforms.page, scene.page);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    scene.setPalette = function (primary, secondary) {
      scene.target = [primary, secondary];
      if (!scene.palette || motion.matches) scene.palette = scene.target.map((c) => c.slice());
    };
    scene.destroy = function () {
      teardown();
      scenes.delete(scene);
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      scene.ready = false;
      rd = null; show = sim = init = null; buffer = null;
      canvas.style.visibility = "hidden";
    });
    canvas.addEventListener("webglcontextrestored", () => {
      lost = false;
      build(scene.design);
      scene.resize();
      scene.draw(0);
    });
    scene.page = rgb("var(--bg-1, #120a22)");
    build(scene.design);
    scene.resize();
    if (scene.ready && scene.design.sim) setupTargets();
    scenes.add(scene);
    return scene;
  }

  // One clock drives every scene on the page (the ground plus any previews).
  const scenes = new Set();
  let raf = 0, last = null;
  function frame(now) {
    raf = 0;
    if (document.hidden || motion.matches) { last = null; return; }
    // Follow elapsed time rather than slowing the flow on expensive frames.
    // Visibility changes reset last, so resuming never catches up hidden time.
    const dt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    scenes.forEach((s) => s.draw(dt));
    if (scenes.size) raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = null;
    if (motion.matches) scenes.forEach((s) => { if (s.target) s.palette = s.target.map((c) => c.slice()); });
    if (!document.hidden) {
      scenes.forEach((s) => s.draw(0));
      if (scenes.size && !motion.matches) raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);

  // ---- the page ground -----------------------------------------------------------
  const canvas = document.querySelector(".ambient-glow canvas");
  const host = canvas && canvas.parentElement;
  const ground = canvas ? createScene(canvas, 240000) : null;
  function setPalette(primary, secondary) {
    const target = [rgb(primary), rgb(secondary)];
    if (host) {
      // Keep an opaque color field available if WebGL is unavailable or lost.
      const css = target.map((c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`);
      host.style.background = `linear-gradient(155deg, ${css[0]}, ${css[1]} 48%, ${css[0]})`;
    }
    if (ground) ground.setPalette(target[0], target[1]);
  }
  if (canvas) {
    const styles = getComputedStyle(document.documentElement);
    setPalette(styles.getPropertyValue("--accent").trim() || "#ff2d3f",
               styles.getPropertyValue("--accent-2").trim() || "#3d7bff");
    window.addEventListener("resize", () => { if (ground) { ground.resize(); ground.draw(0); } });
  }

  window.HyteAmbient = {
    DESIGNS: DESIGNS.map(({ id, name, blurb }) => ({ id, name, blurb })),
    setPalette(primary, secondary) {
      setPalette(primary, secondary);
      if (motion.matches) sync();
    },
    setDesign(id) {
      if (!ground) return;
      ground.setDesign(id);
      ground.resize();
      sync();
    },
    // A small live tile for the settings page. Returns null without WebGL.
    preview(target, { design, primary, secondary }) {
      const scene = createScene(target, 40000, design);
      if (!scene) return null;
      scene.setPalette(rgb(primary), rgb(secondary));
      // The tile is usually created before it is laid out; follow its size.
      const observer = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => { scene.resize(); scene.draw(0); }) : null;
      if (observer) observer.observe(target);
      sync();
      return {
        setPalette(p, s) { scene.setPalette(rgb(p), rgb(s)); if (motion.matches) sync(); },
        destroy() { if (observer) observer.disconnect(); scene.destroy(); },
      };
    },
  };
  sync();
})();
