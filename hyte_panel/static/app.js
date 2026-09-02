/* HYTE Panel front end. Vanilla JS, no build step. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---- Icons (Feather-style paths, 24x24 viewBox) ------------------------------
  const ICONS = {
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><line x1="7" y1="11" x2="7" y2="14"/><line x1="5.5" y1="12.5" x2="8.5" y2="12.5"/><circle cx="16" cy="11.5" r="1"/><circle cx="18.5" cy="14" r="1"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    app: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    "cloud-sun": '<path d="M12 2v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M20 12h2"/><path d="M19.07 4.93l-1.41 1.41"/><path d="M15.95 10.6A4 4 0 1 0 8.5 8.5"/><path d="M17 17.5H7a4 4 0 0 1-.5-7.97 6 6 0 0 1 11.3 2.47A3 3 0 0 1 17 17.5z"/>',
    fog: '<path d="M18 10h-1.26A8 8 0 1 0 9 16h9a3 3 0 0 0 0-6z"/><line x1="5" y1="20" x2="19" y2="20"/><line x1="8" y1="23" x2="16" y2="23"/>',
    drizzle: '<line x1="8" y1="19" x2="8" y2="21"/><line x1="12" y1="17" x2="12" y2="19"/><line x1="16" y1="19" x2="16" y2="21"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
    rain: '<line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
    sleet: '<line x1="8" y1="14" x2="8" y2="16"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="16" y1="14" x2="16" y2="16"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
    snow: '<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="8" y1="20" x2="8.01" y2="20"/><line x1="12" y1="18" x2="12.01" y2="18"/><line x1="12" y1="22" x2="12.01" y2="22"/><line x1="16" y1="16" x2="16.01" y2="16"/><line x1="16" y1="20" x2="16.01" y2="20"/>',
    storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><polyline points="13 11 9 17 15 17 11 23"/>',
  };
  const svg = (key) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ICONS.app}</svg>`;

  // ---- Formatting ----------------------------------------------------------------
  const fmtBytes = (n, per = "") => {
    if (n == null) return "--";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}${per}`;
  };
  const fmtGB = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const fmtTemp = (t) => (t == null ? "--" : `${Math.round(t)}°C`);
  const fmtUptime = (s) => {
    if (s == null) return "--";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `up ${d}d ${h}h` : h > 0 ? `up ${h}h ${m}m` : `up ${m}m`;
  };
  const fmtAge = (s) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
  // Usage color, traffic-light style with hard bands: stripe color, then a fixed
  // yellow, then base color. No blending between them.
  const USAGE_MID = "#ffd23f";
  const USAGE_YELLOW_AT = 50, USAGE_BASE_AT = 75; // percent thresholds
  const heat = (pct) => {
    const p = Math.max(0, Math.min(100, pct ?? 0));
    return p >= USAGE_BASE_AT ? theme.primary : p >= USAGE_YELLOW_AT ? USAGE_MID : theme.secondary;
  };
  // ---- Ring gauge ------------------------------------------------------------------
  function makeRing(el, sub) {
    const r = 40, c = 2 * Math.PI * r;
    el.innerHTML = `<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="value" cx="50" cy="50" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg><div class="label"><b>--</b><small>${sub}</small></div>`;
    const val = el.querySelector(".value"), label = el.querySelector("b");
    return (pct) => {
      const p = Math.max(0, Math.min(100, pct ?? 0));
      val.style.strokeDashoffset = c * (1 - p / 100);
      val.style.stroke = heat(p);
      val.dataset.heat = p;
      label.textContent = pct == null ? "--" : `${Math.round(p)}%`;
    };
  }

  // ---- Theme: colors follow the rgb-runway lighting (see collectors/theme.py) -------
  const theme = { primary: "#ff2d3f", secondary: "#3d7bff", blend: "#b23cff" };
  const hexToRgb = (hex) => hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(",");
  function applyTheme(t) {
    if (!t || !t.primary) return;
    if (t.primary === theme.primary && t.secondary === theme.secondary && t.blend === theme.blend) return;
    Object.assign(theme, { primary: t.primary, secondary: t.secondary, blend: t.blend });
    const root = document.documentElement.style;
    root.setProperty("--accent", theme.primary);
    root.setProperty("--accent-2", theme.secondary);
    root.setProperty("--accent-3", theme.blend);
    root.setProperty("--usage-ramp", `linear-gradient(90deg, ${theme.secondary} ${USAGE_YELLOW_AT}%, ${USAGE_MID} ${USAGE_YELLOW_AT}% ${USAGE_BASE_AT}%, ${theme.primary} ${USAGE_BASE_AT}%)`);
    document.querySelectorAll("[data-heat]").forEach((el) => {
      const c = heat(+el.dataset.heat);
      if (el.tagName === "circle") el.style.stroke = c; else el.style.background = c;
    });
  }
  // ---- Sparkline -------------------------------------------------------------------
  function makeSpark(canvas, max = 100, points = 90) {
    const ctx = canvas.getContext("2d");
    const data = [];
    return (v) => {
      data.push(v == null ? 0 : v);
      if (data.length > points) data.shift();
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = (i / (points - 1)) * w, y = h - (Math.min(d, max) / max) * (h - 6) - 3;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      const rgb = hexToRgb(theme.secondary);
      grad.addColorStop(0, `rgba(${rgb},.45)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      ctx.strokeStyle = theme.secondary;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.lineTo((data.length - 1) / (points - 1) * w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    };
  }

  const cpuRing = makeRing($("cpu-ring"), "usage");
  const gpuRing = makeRing($("gpu-ring"), "usage");
  const cpuSpark = makeSpark($("cpu-spark"));
  const gpuSpark = makeSpark($("gpu-spark"));

  // ---- Clock -----------------------------------------------------------------------
  function tickClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---- Config / apps ---------------------------------------------------------------
  let config = null;
  function applyConfig(cfg) {
    config = cfg;
    $("version").textContent = `hyte-panel ${cfg.version}`;
    const grid = $("apps-grid");
    grid.innerHTML = "";
    cfg.apps.forEach((app) => {
      const btn = document.createElement("button");
      btn.className = "app-btn";
      btn.innerHTML = `${svg(app.icon)}<span>${app.name}</span>`;
      btn.addEventListener("click", () => launchApp(app, btn));
      grid.appendChild(btn);
    });
    if (!cfg.weather.enabled) $("weather-card").hidden = true;
    if (!cfg.agents.enabled) $("agents-card").hidden = true;
    setupDim(cfg.display.dim_after_seconds);
  }

  async function launchApp(app, btn) {
    btn.classList.add("pressed");
    $("launch-status").textContent = `Starting ${app.name}`;
    try {
      const r = await fetch(`/api/launch/${app.index}`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      btn.classList.remove("error");
      setTimeout(() => ($("launch-status").textContent = ""), 3000);
    } catch (err) {
      btn.classList.add("error");
      $("launch-status").textContent = `${app.name}: ${err.message}`;
    } finally {
      setTimeout(() => btn.classList.remove("pressed"), 250);
    }
  }

  // ---- Snapshot rendering ----------------------------------------------------------
  function renderWeather(w) {
    const card = $("weather-card");
    if (!w) return;
    card.classList.toggle("offline", !w.ok);
    if (!w.ok) {
      $("weather-desc").textContent = w.error ? `Weather unavailable: ${w.error}` : "Weather unavailable";
      return;
    }
    const unit = w.units === "imperial" ? "°F" : "°C";
    const wind = w.units === "imperial" ? "mph" : "km/h";
    $("weather-icon").innerHTML = svg(w.icon);
    $("weather-temp").textContent = Math.round(w.temp);
    $("weather-unit").textContent = unit;
    $("weather-desc").textContent = `${w.description}${w.label ? " · " + w.label : ""}`;
    $("weather-meta").textContent = `Feels ${Math.round(w.feels_like)}${unit} · ${w.humidity}% humidity · ${Math.round(w.wind)} ${wind}`;
    $("weather-days").innerHTML = (w.daily || []).map((d) => {
      const day = new Date(d.date + "T12:00:00").toLocaleDateString([], { weekday: "short" });
      return `<div class="weather-day"><span>${day}</span>${svg(d.icon)}<b>${Math.round(d.max)}°</b><span>${Math.round(d.min)}°</span></div>`;
    }).join("");
  }

  function renderSnapshot(s) {
    applyTheme(s.theme);
    $("hostname").textContent = s.hostname || "";
    $("uptime").textContent = fmtUptime(s.uptime_seconds);

    const cpu = s.cpu;
    $("cpu-model").textContent = cpu.model;
    cpuRing(cpu.percent);
    cpuSpark(cpu.percent);
    $("cpu-temp").textContent = fmtTemp(cpu.temp_c);
    $("cpu-freq").textContent = cpu.freq_mhz ? `${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : "--";
    $("cpu-load").textContent = cpu.load ? cpu.load[0].toFixed(2) : "--";
    const cores = $("cpu-cores");
    if (cores.childElementCount !== cpu.per_core.length) {
      cores.style.gridTemplateColumns = `repeat(${Math.min(cpu.per_core.length, 32)}, 1fr)`;
      cores.innerHTML = cpu.per_core.map(() => '<div class="core"><i></i></div>').join("");
    }
    cpu.per_core.forEach((p, i) => (cores.children[i].firstChild.style.width = `${p}%`));

    const gpu = (s.gpus || [])[0];
    if (gpu) {
      $("gpu-model").textContent = gpu.name;
      gpuRing(gpu.util_percent);
      gpuSpark(gpu.util_percent);
      $("gpu-temp").textContent = fmtTemp(gpu.temp_c);
      $("gpu-power").textContent = gpu.power_w == null ? "--" : `${Math.round(gpu.power_w)} W${gpu.power_limit_w ? " / " + Math.round(gpu.power_limit_w) : ""}`;
      $("gpu-clock").textContent = gpu.clock_sm_mhz == null ? "--" : `${Math.round(gpu.clock_sm_mhz)} MHz`;
      $("gpu-fan").textContent = gpu.fan_percent == null ? "--" : `${Math.round(gpu.fan_percent)}%`;
      const vram = gpu.mem_percent ?? 0;
      $("gpu-vram-bar").style.width = `${vram}%`;
      $("gpu-vram-bar").style.background = heat(vram);
      $("gpu-vram-bar").dataset.heat = vram;
      $("gpu-vram").textContent = gpu.mem_used_mb == null ? "--" : `${(gpu.mem_used_mb / 1024).toFixed(1)} / ${(gpu.mem_total_mb / 1024).toFixed(0)} GB`;
    } else {
      $("gpu-model").textContent = "No NVIDIA GPU found";
      gpuRing(null);
    }

    const mem = s.memory;
    $("mem-total").textContent = fmtGB(mem.total);
    $("mem-bar").style.width = `${mem.percent}%`;
    $("mem-bar").style.background = heat(mem.percent);
    $("mem-bar").dataset.heat = mem.percent;
    $("mem-value").textContent = `${fmtGB(mem.used)} (${Math.round(mem.percent)}%)`;
    $("disk-rows").innerHTML = (s.disks || []).map((d) =>
      `<div class="bar-row"><span class="bar-label">${d.mount}</span><div class="bar"><div class="bar-fill" data-heat="${d.percent}" style="width:${d.percent}%;background:${heat(d.percent)}"></div></div><span class="bar-value">${fmtGB(d.used)} / ${fmtGB(d.total)}</span></div>`
    ).join("");

    $("net-iface").textContent = s.network.interface;
    $("net-down").textContent = fmtBytes(s.network.down_bps, "/s");
    $("net-up").textContent = fmtBytes(s.network.up_bps, "/s");
    $("fans").innerHTML = (s.fans || []).map((f) => `<span class="fan">${f.name} <b>${f.rpm} rpm</b></span>`).join("");

    renderWeather(s.weather);
    renderAgents(s.agents || []);
  }

  const agentCache = new Map();
  function renderAgents(list) {
    agentCache.clear();
    list.forEach((a) => agentCache.set(a.id, a));
    drawAgents();
  }
  function drawAgents() {
    const list = [...agentCache.values()];
    const el = $("agent-list");
    if (!list.length) {
      el.innerHTML = '<div class="agent-empty">No agents detected. Start Claude Code, Codex or another agent, or send hook events to this panel.</div>';
      $("agent-summary").textContent = "None running";
      return;
    }
    const counts = {};
    list.forEach((a) => (counts[a.status] = (counts[a.status] || 0) + 1));
    $("agent-summary").textContent = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ");
    el.innerHTML = list.map((a) => {
      const side = a.source === "process"
        ? `${a.cpu_percent != null ? Math.round(a.cpu_percent) + "% cpu · " : ""}${a.memory_mb != null ? Math.round(a.memory_mb) + " MB" : ""}`
        : `${a.tools_used} tools · ${fmtAge(a.age_seconds)} ago`;
      return `<div class="agent ${a.status}"><span class="light"></span><div><div class="agent-name">${a.name}${a.project ? `<small>${a.project}</small>` : ""}</div><div class="agent-detail">${a.detail || ""}</div></div><div class="agent-side"><b>${a.status}</b>${side}</div></div>`;
    }).join("");
  }

  // ---- Idle dimming ------------------------------------------------------------------
  let dimTimer = null;
  function setupDim(seconds) {
    const dim = $("dim");
    if (dimTimer) clearTimeout(dimTimer);
    if (!seconds || seconds <= 0) { dim.hidden = true; return; }
    const arm = () => { clearTimeout(dimTimer); dim.hidden = true; dimTimer = setTimeout(() => (dim.hidden = false), seconds * 1000); };
    ["pointerdown", "touchstart", "keydown"].forEach((ev) => document.addEventListener(ev, arm, { passive: true }));
    arm();
  }
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- Transport: WebSocket with polling fallback -------------------------------------
  const conn = $("conn");
  let ws = null, pollTimer = null, retry = 1000;

  function startPolling() {
    if (pollTimer) return;
    const poll = async () => {
      try {
        if (!config) applyConfig(await (await fetch("/api/config")).json());
        renderSnapshot(await (await fetch("/api/snapshot")).json());
        conn.className = "conn online"; conn.textContent = "polling";
      } catch (e) {
        conn.className = "conn offline"; conn.textContent = "offline";
      }
      pollTimer = setTimeout(poll, (config ? config.refresh_seconds : 2) * 1000);
    };
    poll();
  }
  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 1000; stopPolling(); conn.className = "conn online"; conn.textContent = "live"; };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "config") applyConfig(msg.data);
      else if (msg.type === "snapshot") renderSnapshot(msg.data);
      else if (msg.type === "agent") { agentCache.set(msg.data.id, msg.data); drawAgents(); }
    };
    ws.onclose = () => {
      conn.className = "conn offline"; conn.textContent = "reconnecting";
      startPolling();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15000);
    };
    ws.onerror = () => ws.close();
  }
  setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 20000);
  connect();
})();
