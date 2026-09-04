# Cellular automata playground

A touch-first cellular automata module for the HYTE Y70 panel, and a standalone
dev page to work on it. Vanilla JS, no build step.

The module itself is served by the panel from `hyte_panel/static/ca/`. This
directory holds the dev page, the tests and these notes.

The world runs on the GPU: a WebGL2 fragment shader steps a pair of `RGBA8UI`
textures, another draws them with the panel's live palette. A CPU engine with
the same interface takes over if WebGL2 is unavailable.

## Run the dev page

```bash
python3 -m http.server 8080          # from the repo root
# open http://localhost:8080/automata/  (add ?engine=cpu to force the fallback)
```

The page shows a 682 x 2560 frame like the HYTE screen. Drag to paint, hold to
stamp a pattern. Keys: space play/pause, `s` step, `r` seed, `c` clear, `n` next
rule.

## Rules

| Family | Rules | Notes |
|---|---|---|
| Life-like | Life, HighLife, Day & Night, Diamoeba, Coral, Maze, Anneal, Seeds, random `B?/S?` | Cells colour by age: newborn = stripe colour, old = base colour. Dead cells leave an afterglow. |
| Generations | Brian's Brain, Star Wars | Dying states fade through the blend colour. |
| Elementary (1D) | Rule 30, 90, 110, 184 | Space-time diagram. Newest row at the bottom, history scrolls up. |
| Cyclic | Cyclic (14 states, T1), Cyclic T3 | Colour wheel over the palette. Spirals from noise. |

## Behaviour on the panel

- **Attract mode.** After 45 s without a touch the module rotates through the
  curated rules every 2 minutes, and sooner when the world dies or freezes
  (population zero, or the state hash repeating within 8 samples for 3 s).
- **Reactive.** `ca.onSnapshot(snapshot)` takes the panel's hardware snapshot.
  CPU load scales the generation rate in attract mode, network traffic injects
  cells along the top edge, and an AI agent changing status fires a glider.
- **Theme.** Colours are read from the host's `--accent`, `--accent-2` and
  `--accent-3` CSS variables once a second, or set with `ca.setTheme({primary,
  secondary, blend})`.

## API

```js
const ca = CA.mount(element, {
  rule: "life",          // id from CA.RULES or a rule object {name, rule:"B3/S23"}
  cell: 2,               // device pixels per cell
  header: true,          // render the title/status row
  attract: { idle: 45, rotate: 120 } | false,
  theme: null,           // null = follow CSS variables
  engine: "auto",        // auto | gpu | cpu
  size: null,            // {w, h} fixed grid (tests); default fills the element
});
ca.setRule("brain"); ca.play(); ca.pause(); ca.step(); ca.seed(); ca.clear();
ca.setSpeed(30); ca.stamp(CA.STAMPS[0], x, y); ca.onSnapshot(snap); ca.setPaused(hidden);
ca.read();             // Uint8Array RGBA8 of the whole grid
ca.destroy();
```

## Layout

```
hyte_panel/static/ca/core.js   rule table, rule parser, CPU stepper, stamps (browser + node)
hyte_panel/static/ca/ca.js     WebGL2 engine, CPU engine, touch UI, attract mode, snapshot hooks
hyte_panel/static/ca/ca.css    styles; picks up the panel's CSS variables when present
automata/index.html            dev page with a HYTE-shaped frame
automata/test/core.test.js     node tests for the rule semantics
automata/test/gpu.html         GPU vs CPU comparison for every rule, run in WebKitGTK
automata/test/run-webkit.py    loads a test page in WebKitGTK and prints the result
```

The panel wires the module in from `hyte_panel/static/app.js` (`mountAutomata`)
using the `[automata]` config section. After editing the module, reinstall the
panel and restart the service as described in the main README under
"Update later".

## Tests

```bash
# from the repo root
node --test automata/test/*.test.js                       # rule semantics on the CPU reference
python3 automata/test/run-webkit.py automata/test/gpu.html   # GPU shader vs CPU reference, byte for byte
```
