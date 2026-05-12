// PLAGUE — game logic.
//
// Game loop runs at a fixed tick rate driven by speed. Each tick = 1 day.
// All disease state lives on State; the canvas + DOM are repainted from State each tick.
(function () {
  'use strict';

  // ───────────────────────────── helpers ─────────────────────────────
  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function fmt(n) {
    n = Math.round(n);
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3)  return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  function pct(x, digits) { return (x * 100).toFixed(digits ?? 0) + '%'; }
  function int(n) { return Math.max(0, Math.round(n)); }

  // ───────────────────────────── state ─────────────────────────────
  const TICK_MS = { 1: 700, 2: 350, 3: 100 };

  const State = {
    started: false,
    paused: true,
    speed: 2,
    day: 0,
    dna: 0,
    plagueName: 'Patient Zero',
    difficulty: 'normal',
    cure: 0,
    cureStarted: false,
    cureRateMul: 1,
    evolved: new Set(),
    countries: [],
    stats: {},
    news: [],
    bubbles: [],
    nextBubbleId: 1,
    activeCategory: 'transmission',
    activeTab: 'disease',
    lastTickAt: 0,
    accum: 0,
    selectedCountryIdx: -1,
    evoFingerprint: '',
  };

  const DIFFICULTY = {
    casual: { cureRate: 0.6, infMul: 1.15, dnaMul: 1.2 },
    normal: { cureRate: 1.0, infMul: 1.0,  dnaMul: 1.0 },
    brutal: { cureRate: 1.6, infMul: 0.85, dnaMul: 0.85 },
  };

  function totalPop() {
    return State.countries.reduce((s, c) => s + c.population, 0);
  }
  function totals() {
    let inf = 0, dead = 0, healthy = 0;
    for (const c of State.countries) { inf += c.infected; dead += c.dead; healthy += c.healthy; }
    return { inf, dead, healthy };
  }

  // ───────────────────────────── init UI ─────────────────────────────
  function buildStartScreen() {
    const sel = $('startCountry');
    sel.innerHTML = '';
    WORLD.countries.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${c.name} (${fmt(c.population)})`;
      sel.appendChild(o);
    });
    sel.value = String(WORLD.byName.get('Saudi Arabia') ?? 0);
  }

  function bindUI() {
    $('startBtn').addEventListener('click', startGame);
    $('restartBtn').addEventListener('click', () => location.reload());
    $('pauseBtn').addEventListener('click', () => {
      State.paused = !State.paused;
      $('pauseBtn').textContent = State.paused ? 'Resume' : 'Pause';
    });
    document.querySelectorAll('.speed-btn').forEach((b) => {
      b.addEventListener('click', () => {
        State.speed = Number(b.dataset.speed);
        document.querySelectorAll('.speed-btn').forEach((x) => x.classList.toggle('active', x === b));
      });
    });
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        State.activeTab = b.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab-content').forEach((tc) => {
          tc.classList.toggle('hidden', tc.id !== ('tab-' + State.activeTab));
        });
        renderTab();
      });
    });
    document.querySelectorAll('.cat-btn').forEach((b) => {
      b.addEventListener('click', () => {
        State.activeCategory = b.dataset.cat;
        document.querySelectorAll('.cat-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderEvolutions();
      });
    });
    $('countryFilter').addEventListener('input', renderCountryList);

    // Canvas hover for country tooltip
    const cv = $('worldCanvas');
    cv.addEventListener('mousemove', onCanvasMove);
    cv.addEventListener('mouseleave', () => $('tooltip').classList.add('hidden'));
  }

  function startGame() {
    State.plagueName = $('plagueName').value.trim() || 'Patient Zero';
    State.difficulty = $('difficulty').value;
    const startIdx = Number($('startCountry').value);

    // Clone countries with simulation state
    State.countries = WORLD.countries.map((c) => ({
      ...c,
      healthy: c.population,
      infected: 0,
      dead: 0,
      detected: false,
      closed: false,
      researching: false,
      announcedInfected: false,
    }));

    // Seed initial infection (about 1 person becomes ~10 for sim stability)
    const seed = Math.max(10, State.countries[startIdx].population * 1e-8);
    State.countries[startIdx].healthy -= seed;
    State.countries[startIdx].infected += seed;
    State.countries[startIdx].announcedInfected = true;
    newsItem(`Patient zero identified in ${State.countries[startIdx].name}.`, 'info');

    State.started = true;
    State.paused = false;
    State.ended = false;
    State.day = 0;
    State.dna = 8;
    State.cure = 0;
    State.cureStarted = false;
    State.evolved = new Set();
    State.bubbles = [];
    State.news = State.news.slice(0, 1); // keep the seed news
    recomputeStats();

    $('plagueLabel').textContent = State.plagueName;
    $('startScreen').classList.add('hidden');
    $('pauseBtn').textContent = 'Pause';

    renderEvolutions();
    renderHud();
    renderCanvas();
    if (!State.lastTickAt) requestAnimationFrame(loop);
  }

  // ───────────────────────────── stats ─────────────────────────────
  // Recompute aggregate disease stats from owned evolutions.
  function recomputeStats() {
    const s = {
      infectivity: 1, severity: 0, lethality: 0,
      trans_air: 0, trans_water: 0, trans_livestock: 0, trans_rodent: 0,
      trans_insect: 0, trans_bird: 0, trans_blood: 0,
      coldResist: 0, heatResist: 0,
      cureResist: 0,
      urbanBoost: 0, ruralBoost: 0, hotBoost: 0, poorBoost: 0, crossSeaJump: 0,
    };
    for (const id of State.evolved) {
      const e = EVO_BY_ID.get(id);
      if (!e) continue;
      const eff = e.effects || {};
      for (const k of Object.keys(eff)) {
        s[k] = (s[k] || 0) + eff[k];
      }
    }
    s.infectivity = clamp(s.infectivity, 0, 100);
    s.severity = clamp(s.severity, 0, 100);
    s.lethality = clamp(s.lethality, 0, 100);
    s.cureResist = clamp(s.cureResist, 0, 0.85);
    State.stats = s;
  }

  // ───────────────────────────── simulation ─────────────────────────────
  function transmissionCount(s) {
    return s.trans_air + s.trans_water + s.trans_livestock + s.trans_rodent +
           s.trans_insect + s.trans_bird + s.trans_blood;
  }

  // β: per-day local effective contact rate.
  function computeBeta(c) {
    const s = State.stats;
    const dif = DIFFICULTY[State.difficulty];

    // climate match — disease loves temperate by default; resistances let it cope with extremes.
    let climate = 1;
    if (c.climate === 'cold')                 climate = 0.45 + 0.25 * s.coldResist;
    else if (c.climate === 'arid')            climate = 0.65 + 0.20 * s.heatResist;
    else if (c.climate === 'hot' ||
             c.climate === 'tropical')        climate = 0.55 + 0.22 * s.heatResist;
    else                                      climate = 1.0;
    climate = clamp(climate, 0.25, 1.4);

    let density = c.density === 'urban' ? 1 + s.urbanBoost : 1 + s.ruralBoost;
    let wealth  = c.wealth === 0 ? (1 + s.poorBoost) : (c.wealth === 2 ? 0.85 : 1);
    let hot     = (c.climate === 'hot' || c.climate === 'tropical' || c.climate === 'arid') ? (1 + s.hotBoost) : 1;

    const base = 0.12;
    const infFactor = 0.4 + (s.infectivity / 60); // 0.4 .. ~2.0
    const transFactor = 1 + 0.10 * transmissionCount(s);

    return base * infFactor * transFactor * climate * density * wealth * hot * dif.infMul;
  }

  function deathRate() {
    // ~0 at lethality 0, ~3.5%/day at lethality 100 (≈ 70% dead over 30 days).
    const l = State.stats.lethality / 100;
    return Math.pow(l, 1.1) * 0.035;
  }

  function tryDetect(c) {
    if (c.detected) return;
    const s = State.stats;
    const infRatio = c.infected / Math.max(1, c.population);
    if (
      c.dead > Math.max(20, c.population * 5e-7) ||
      (s.severity >= 8 && infRatio > 0.0008) ||
      (s.lethality >= 10 && c.infected > 100)
    ) {
      c.detected = true;
      newsItem(`${c.name} detects outbreak`, 'warn');
    }
  }

  function tryClose(c) {
    if (!c.detected || c.closed) return;
    const s = State.stats;
    // Likelihood of closing borders rises with awareness, lethality, and wealth.
    const p = 0.0006 * (1 + s.lethality / 25) * (1 + c.wealth) * (s.severity > 15 ? 1.5 : 1);
    if (Math.random() < p) {
      c.closed = true;
      newsItem(`${c.name} closes its borders`, 'info');
    }
  }

  function seedCountry(country, amount) {
    if (country.healthy <= 0) return;
    const seed = Math.min(country.healthy, Math.max(5, amount));
    country.healthy -= seed;
    country.infected += seed;
    if (!country.announcedInfected) {
      country.announcedInfected = true;
      newsItem(`${country.name} reports first cases`);
    }
  }

  function maybeSeedNeighbors(c) {
    if (c.closed) return;
    const s = State.stats;
    const infRatio = c.infected / Math.max(1, c.population);
    const baseChance = infRatio * (1 + 0.12 * transmissionCount(s)) * 0.6;
    for (const nid of c.borderIds) {
      const n = State.countries[nid];
      if (!n || n.closed) continue;
      if (Math.random() < clamp(baseChance, 0, 0.5)) {
        seedCountry(n, n.population * 1e-7 + 5);
      }
    }
  }

  function maybeSeedHub(c, kind) {
    if (c.closed) return;
    const s = State.stats;
    const hasFlag = kind === 'air' ? c.airport : c.seaport;
    const transBoost = kind === 'air'
      ? (s.trans_air + 0.4 * s.trans_bird)
      : (s.trans_water + 0.3 * s.trans_blood);
    if (!hasFlag || transBoost <= 0) return;
    const infRatio = c.infected / Math.max(1, c.population);
    const chance = clamp(infRatio * transBoost * (kind === 'air' ? 0.55 : 0.32), 0, 0.35);
    if (Math.random() > chance) return;
    // Pick a random eligible target.
    const pool = State.countries.filter((o) =>
      o.id !== c.id && !o.closed &&
      (kind === 'air' ? o.airport : o.seaport) && o.healthy > 0,
    );
    if (!pool.length) return;
    const target = pick(pool);
    seedCountry(target, target.population * 8e-8 + 5);
  }

  function maybeBirdHop(c) {
    const s = State.stats;
    if (s.trans_bird <= 0 || c.closed) return;
    const infRatio = c.infected / Math.max(1, c.population);
    if (Math.random() > clamp(infRatio * s.trans_bird * 0.25, 0, 0.2)) return;
    // Birds prefer geographically nearby countries.
    const candidates = State.countries
      .filter((o) => o.id !== c.id && o.healthy > 0)
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
      .slice(0, 6);
    if (!candidates.length) return;
    seedCountry(pick(candidates), 8);
  }

  function simulateCountries() {
    const s = State.stats;
    const dr = deathRate();

    for (const c of State.countries) {
      if (c.infected <= 0) continue;
      // SIR-ish update.
      const beta = computeBeta(c);
      const newInf = clamp(beta * c.infected * c.healthy / Math.max(1, c.population), 0, c.healthy);
      c.healthy -= newInf;
      c.infected += newInf;

      const deaths = Math.min(c.infected, dr * c.infected);
      c.infected -= deaths;
      c.dead += deaths;

      // Round sub-person float residuals to 0 once the country is "spent".
      if (c.healthy > 0 && c.healthy < 1) { c.infected += c.healthy; c.healthy = 0; }
      if (c.infected > 0 && c.infected < 1 && c.healthy === 0) { c.dead += c.infected; c.infected = 0; }

      tryDetect(c);
      tryClose(c);

      maybeSeedNeighbors(c);
      maybeSeedHub(c, 'air');
      maybeSeedHub(c, 'sea');
      maybeBirdHop(c);

      // Researching: a detected country actively researches the cure if not too overwhelmed.
      c.researching = c.detected && (c.healthy / Math.max(1, c.population)) > 0.05;
    }
  }

  function progressCure() {
    const s = State.stats;
    const dif = DIFFICULTY[State.difficulty];
    if (!State.cureStarted) {
      // Cure research kicks off when severity is publicly visible or several nations are aware.
      const detectedCount = State.countries.filter((c) => c.detected).length;
      if (detectedCount >= 3 || s.severity > 18) {
        State.cureStarted = true;
        newsItem('World Health Organization begins cure research.', 'bad');
      }
    }
    if (!State.cureStarted) return;
    // Sum contributions from researching countries.
    let contribution = 0;
    for (const c of State.countries) {
      if (!c.researching) continue;
      const healthyRatio = c.healthy / Math.max(1, c.population);
      const w = c.wealth + 0.5;        // 0.5 .. 2.5
      contribution += w * healthyRatio * 0.0035;
    }
    // Lethality drags research down a bit (chaos).
    const drag = 1 - clamp(s.lethality / 220, 0, 0.45);
    const resist = 1 - s.cureResist;
    const dailyCure = contribution * drag * resist * dif.cureRate;
    State.cure = clamp(State.cure + dailyCure, 0, 100);
  }

  function generateDNA() {
    // Slow trickle.
    const dif = DIFFICULTY[State.difficulty];
    if (State.day % 3 === 0) {
      State.dna += Math.max(1, Math.round(dif.dnaMul));
    }
  }

  // ───────────────────────────── bubbles ─────────────────────────────
  function spawnBubble() {
    // Spawn rate slows when no infection.
    const t = totals();
    if (t.inf <= 0) return;

    // Cure bubble appears once cure is progressing.
    const cureBubble = State.cureStarted && Math.random() < 0.35;
    // Choose a country to anchor the bubble.
    let candidate;
    if (cureBubble) {
      const researchers = State.countries.filter((c) => c.researching);
      candidate = researchers.length ? pick(researchers) : pick(State.countries);
    } else {
      const infected = State.countries.filter((c) => c.infected > 0);
      if (!infected.length) return;
      candidate = pick(infected);
    }
    const b = {
      id: State.nextBubbleId++,
      kind: cureBubble ? 'cure' : 'dna',
      x: candidate.x + (Math.random() - 0.5) * 30,
      y: candidate.y + (Math.random() - 0.5) * 24,
      ttl: 6,
      value: cureBubble ? (1 + Math.random() * 1.5) : (1 + Math.floor(Math.random() * 3)),
    };
    State.bubbles.push(b);
  }

  function ageBubbles(dt) {
    for (const b of State.bubbles) b.ttl -= dt;
    State.bubbles = State.bubbles.filter((b) => b.ttl > 0);
  }

  function bindBubbleHandlers() {
    const cont = $('bubbles');
    cont.addEventListener('click', (ev) => {
      const t = ev.target.closest('.bubble');
      if (!t) return;
      const id = Number(t.dataset.id);
      const idx = State.bubbles.findIndex((b) => b.id === id);
      if (idx === -1) return;
      const b = State.bubbles[idx];
      if (b.kind === 'dna') {
        State.dna += b.value;
        newsItem(`Collected DNA bubble (+${b.value}).`, 'info');
      } else {
        State.cure = Math.max(0, State.cure - b.value);
        newsItem(`Slowed cure research (-${b.value.toFixed(1)}%).`, 'info');
      }
      State.bubbles.splice(idx, 1);
      renderBubbles();
      renderHud();
    });
  }

  // ───────────────────────────── news ─────────────────────────────
  function newsItem(text, kind) {
    State.news.unshift({ day: State.day, text, kind: kind || '' });
    if (State.news.length > 40) State.news.length = 40;
    renderNews();
  }

  function renderNews() {
    const root = $('news');
    if (!root) return;
    root.innerHTML = State.news.slice(0, 8).map((n) =>
      `<div class="news-item ${n.kind || ''}"><span class="day">Day ${n.day}</span>${n.text}</div>`
    ).join('');
  }

  // ───────────────────────────── render: hud ─────────────────────────────
  function renderHud() {
    const t = totals();
    $('day').textContent = State.day;
    $('infectedCount').textContent = fmt(t.inf);
    $('deadCount').textContent = fmt(t.dead);
    $('healthyCount').textContent = fmt(t.healthy);
    $('dna').textContent = State.dna;

    const s = State.stats;
    $('infBar').style.width = clamp(s.infectivity, 0, 100) + '%';
    $('sevBar').style.width = clamp(s.severity, 0, 100) + '%';
    $('lethBar').style.width = clamp(s.lethality, 0, 100) + '%';
    $('cureBar').style.width = clamp(State.cure, 0, 100) + '%';
    $('infNum').textContent = Math.round(s.infectivity);
    $('sevNum').textContent = Math.round(s.severity);
    $('lethNum').textContent = Math.round(s.lethality);
    $('cureNum').textContent = State.cure.toFixed(1) + '%';
  }

  // Rebuild only the active tab and only when its inputs changed. The Disease
  // tab is rebuilt only when DNA or owned evolutions change, to avoid flicker.
  function renderTab() {
    if (State.activeTab === 'world') return renderCountryList();
    if (State.activeTab === 'stats') return renderStatsView();
    const fp = State.dna + ':' + Array.from(State.evolved).sort().join(',');
    if (fp !== State.evoFingerprint) {
      State.evoFingerprint = fp;
      renderEvolutions();
    }
  }

  function renderEvolutions() {
    const list = $('evolutionList');
    const cat = State.activeCategory;
    list.innerHTML = '';
    const items = EVOLUTIONS.filter((e) => e.cat === cat);
    for (const e of items) {
      const owned = State.evolved.has(e.id);
      const reqsMet = e.reqs.every((r) => State.evolved.has(r));
      const affordable = State.dna >= e.cost;
      const div = document.createElement('div');
      div.className = 'evo' + (owned ? ' owned' : '') + (!reqsMet && !owned ? ' locked' : '');
      div.innerHTML = `
        <div>
          <div class="name">${e.name}</div>
          <div class="desc">${e.desc}</div>
          ${e.reqs.length ? `<div class="desc" style="margin-top:4px;color:#5a6473;">Requires: ${e.reqs.map((r) => EVO_BY_ID.get(r).name).join(', ')}</div>` : ''}
        </div>
        <div class="cost">${owned ? '✓' : e.cost}</div>
      `;
      if (!owned && reqsMet) {
        div.addEventListener('click', () => buyEvolution(e));
      }
      if (!owned && reqsMet && !affordable) {
        div.style.opacity = '0.65';
        div.title = 'Not enough DNA';
      }
      list.appendChild(div);
    }
  }

  function buyEvolution(e) {
    if (State.evolved.has(e.id)) return;
    if (State.dna < e.cost) return;
    State.dna -= e.cost;
    State.evolved.add(e.id);
    if (typeof e.onEvolve === 'function') e.onEvolve(State);
    recomputeStats();
    newsItem(`Evolved: ${e.name}`, 'info');
    renderHud();
    State.evoFingerprint = '';
    renderEvolutions();
  }

  function renderCountryList() {
    const root = $('countryList');
    const q = ($('countryFilter').value || '').toLowerCase();
    const rows = State.countries
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => (b.c.infected + b.c.dead) - (a.c.infected + a.c.dead));
    root.innerHTML = rows.map(({ c }) => {
      const p = (c.infected + c.dead) / c.population;
      const cls = 'country-row' + (c.closed ? ' closed' : '');
      return `<div class="${cls}">
        <div>${c.name}</div>
        <div class="pct">${pct(p, 1)}</div>
        <div class="deaths">${fmt(c.dead)} dead</div>
      </div>`;
    }).join('');
  }

  function renderStatsView() {
    const root = $('statsView');
    const t = totals();
    const tot = t.inf + t.dead + t.healthy;
    const s = State.stats;
    const detectedCount = State.countries.filter((c) => c.detected).length;
    const closedCount = State.countries.filter((c) => c.closed).length;
    const reach = State.countries.filter((c) => c.infected > 0 || c.dead > 0).length;
    root.innerHTML = [
      ['Day', State.day],
      ['Plague', State.plagueName],
      ['Difficulty', State.difficulty],
      ['Countries reached', `${reach} / ${State.countries.length}`],
      ['Countries detected', detectedCount],
      ['Borders closed', closedCount],
      ['World population', fmt(tot)],
      ['Healthy', `${fmt(t.healthy)} (${pct(t.healthy / tot, 1)})`],
      ['Infected', `${fmt(t.inf)} (${pct(t.inf / tot, 1)})`],
      ['Dead', `${fmt(t.dead)} (${pct(t.dead / tot, 1)})`],
      ['Infectivity', Math.round(s.infectivity)],
      ['Severity', Math.round(s.severity)],
      ['Lethality', Math.round(s.lethality)],
      ['Cure resistance', pct(s.cureResist, 0)],
      ['Cure progress', State.cure.toFixed(1) + '%'],
    ].map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  // ───────────────────────────── render: canvas ─────────────────────────────
  function resizeCanvas() {
    const cv = $('worldCanvas');
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.floor(rect.width * dpr));
    cv.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = cv.getContext('2d');
    const sx = (rect.width / WORLD.width) * dpr;
    const sy = (rect.height / WORLD.height) * dpr;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }

  // Soft continent blobs purely for visual context — not geographically accurate.
  const CONTINENT_BLOBS = [
    // North America
    { x: 195, y: 200, rx: 95, ry: 130 },
    // South America
    { x: 305, y: 370, rx: 55, ry: 100 },
    // Europe
    { x: 495, y: 190, rx: 70, ry: 60 },
    // Africa
    { x: 555, y: 330, rx: 70, ry: 110 },
    // Asia
    { x: 750, y: 220, rx: 170, ry: 110 },
    // Indo-Pacific (Indonesia/Australia)
    { x: 890, y: 380, rx: 95, ry: 75 },
    // Greenland / arctic
    { x: 395, y: 100, rx: 45, ry: 35 },
  ];

  function drawWorld(ctx) {
    // Subtle continent shading.
    ctx.save();
    ctx.fillStyle = 'rgba(55, 70, 90, 0.35)';
    for (const b of CONTINENT_BLOBS) {
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Faint grid lines.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= WORLD.width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  function countryColor(c) {
    if (c.population <= 0) return '#777';
    const deadRatio = c.dead / c.population;
    const infRatio = c.infected / c.population;
    const totalRatio = clamp(deadRatio + infRatio, 0, 1);
    if (totalRatio === 0) return '#4cd28a';            // green / healthy
    if (deadRatio > 0.5) return '#3a0a12';             // near-extinct
    if (deadRatio > 0.2) return '#7d1322';
    if (deadRatio > 0.05) return '#c33247';
    if (infRatio > 0.4) return '#ff7e54';              // heavily infected
    if (infRatio > 0.1) return '#ffae6b';
    if (infRatio > 0.01) return '#ffd166';
    return '#9ad8ff';                                  // first reported cases
  }

  function countryRadius(c) {
    // Logarithmic by population so big and small both visible.
    return 4 + Math.log10(Math.max(1, c.population / 1e6)) * 3.2;
  }

  function drawCountries(ctx) {
    // Border lines for adjacency
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 126, 84, 0.18)';
    ctx.lineWidth = 1;
    for (const c of State.countries) {
      if (c.infected <= 0) continue;
      for (const nid of c.borderIds) {
        const n = State.countries[nid];
        if (!n) continue;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Country dots
    for (const c of State.countries) {
      const r = countryRadius(c);
      const color = countryColor(c);
      ctx.save();
      // glow
      const infRatio = c.infected / Math.max(1, c.population);
      if (infRatio > 0.001) {
        const g = ctx.createRadialGradient(c.x, c.y, r * 0.4, c.x, c.y, r * 3.5);
        g.addColorStop(0, 'rgba(255, 126, 84, 0.35)');
        g.addColorStop(1, 'rgba(255, 126, 84, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.closed ? '#b6c1d3' : 'rgba(0,0,0,0.4)';
      ctx.setLineDash(c.closed ? [3, 2] : []);
      ctx.lineWidth = c.closed ? 1.5 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
      // label small
      ctx.fillStyle = 'rgba(220, 230, 240, 0.85)';
      ctx.font = '9px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.name, c.x, c.y + r + 10);
      ctx.restore();
    }
  }

  function renderCanvas() {
    const cv = $('worldCanvas');
    const ctx = cv.getContext('2d');
    ctx.save();
    // Reset transform briefly to clear in device pixels then re-apply.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.restore();
    drawWorld(ctx);
    drawCountries(ctx);
  }

  function renderBubbles() {
    const root = $('bubbles');
    const rect = $('world').getBoundingClientRect();
    const sx = rect.width / WORLD.width;
    const sy = rect.height / WORLD.height;
    root.innerHTML = State.bubbles.map((b) =>
      `<div class="bubble ${b.kind === 'cure' ? 'cure' : ''}" data-id="${b.id}"
          style="left:${(b.x * sx) - 14}px; top:${(b.y * sy) - 14}px;"></div>`
    ).join('');
  }

  // ───────────────────────────── canvas mouse ─────────────────────────────
  function canvasCoords(ev) {
    const cv = $('worldCanvas');
    const rect = cv.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * WORLD.width,
      y: ((ev.clientY - rect.top) / rect.height) * WORLD.height,
    };
  }

  function nearestCountry(p) {
    let best = null, bestD = Infinity;
    for (const c of State.countries) {
      const r = countryRadius(c) + 6;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < r && d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  function onCanvasMove(ev) {
    if (!State.started) return;
    const p = canvasCoords(ev);
    const c = nearestCountry(p);
    const tip = $('tooltip');
    if (!c) { tip.classList.add('hidden'); return; }
    const r = (c.infected + c.dead) / c.population;
    tip.classList.remove('hidden');
    tip.style.left = (ev.clientX + 14) + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
    tip.innerHTML = `
      <div class="tt-name">${c.name} ${c.closed ? '(closed)' : ''}</div>
      <div class="tt-stats">
        <div>Population: <span>${fmt(c.population)}</span></div>
        <div>Infected: <span>${fmt(c.infected)}</span></div>
        <div>Dead: <span>${fmt(c.dead)}</span></div>
        <div>Healthy: <span>${fmt(c.healthy)}</span></div>
        <div>Affected: <span>${pct(r, 2)}</span></div>
        <div>Climate: <span>${c.climate}</span> · Density: <span>${c.density}</span> · Wealth: <span>${['poor','medium','rich'][c.wealth]}</span></div>
      </div>
    `;
  }

  // ───────────────────────────── end of game ─────────────────────────────
  function checkEnd() {
    if (State.ended) return;
    const t = totals();
    if (State.cure >= 100) {
      endGame(false, `A vaccine was deployed. ${fmt(t.healthy + t.inf)} people survived.`);
      return;
    }
    // Total annihilation: every host accounted for.
    if (t.healthy < 1 && t.inf < 1 && t.dead > 0) {
      endGame(true, `${State.plagueName} consumed every human host.`);
      return;
    }
    // Civilizational collapse: multiplicative SIR-style decay leaves tiny pockets of survivors
    // that the disease can no longer reach. When ≥99.9% of humanity is dead and the active
    // outbreak has run its course, declare the pathogen the winner.
    const totalPop = t.healthy + t.inf + t.dead;
    if (totalPop > 0 && t.inf < 1 && t.dead / totalPop >= 0.999) {
      endGame(true, `Civilization collapsed. The last ${fmt(t.healthy)} stragglers cannot rebuild.`);
      return;
    }
    // If everyone has been infected at some point AND lethality is too low to ever finish, end anyway
    if (t.healthy < 1 && t.dead > 0 && t.inf >= 1 && State.stats.lethality < 5 && State.day > 4000) {
      endGame(true, `${State.plagueName} infected everyone but the survivors carried on.`);
    }
  }

  function endGame(won, msg) {
    State.paused = true;
    State.ended = true;
    const t = totals();
    $('endTitle').textContent = won ? 'Victory' : 'Defeat';
    $('endText').textContent = won
      ? `The pathogen wins. ${msg}`
      : `Humanity wins. ${msg}`;
    $('endStats').innerHTML = [
      ['Day', State.day],
      ['Plague', State.plagueName],
      ['Difficulty', State.difficulty],
      ['Dead', fmt(t.dead)],
      ['Infected', fmt(t.inf)],
      ['Survivors', fmt(t.healthy)],
      ['Cure', State.cure.toFixed(1) + '%'],
    ].map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
    $('endScreen').classList.remove('hidden');
  }

  // ───────────────────────────── main loop ─────────────────────────────
  function loop(now) {
    if (!State.lastTickAt) State.lastTickAt = now;
    const dt = Math.min(300, now - State.lastTickAt);
    State.lastTickAt = now;

    if (!State.paused && State.started) {
      State.accum += dt;
      const tickEvery = TICK_MS[State.speed];
      let ticks = 0;
      while (State.accum >= tickEvery && ticks < 20) {
        State.accum -= tickEvery;
        State.day++;
        simulateCountries();
        progressCure();
        generateDNA();
        if (State.day % 4 === 0 && State.bubbles.length < 5) spawnBubble();
        checkEnd();
        ticks++;
      }
      ageBubbles(dt / 1000 * (1000 / Math.max(60, tickEvery)));
      renderHud();
      renderTab();
      renderCanvas();
      renderBubbles();
    }
    requestAnimationFrame(loop);
  }

  // ───────────────────────────── boot ─────────────────────────────
  function boot() {
    buildStartScreen();
    bindUI();
    bindBubbleHandlers();
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); renderCanvas(); renderBubbles(); });
    // Initial render (empty world).
    State.countries = WORLD.countries.map((c) => ({ ...c, healthy: c.population, infected: 0, dead: 0, detected: false, closed: false, researching: false }));
    recomputeStats();
    renderHud();
    renderCanvas();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
