/* Slumpad barrunda: picks a random bar, never repeats until all are visited. */
(() => {
  'use strict';

  const KEY_VISITED = 'slumpad-barrunda:besokta';
  const KEY_CURRENT = 'slumpad-barrunda:aktuell';
  const KEY_HISTORY = 'slumpad-barrunda:historik'; // stack of { visited, current } before each pick, for "Ångra"
  const KEY_QUEUE = 'slumpad-barrunda:ko'; // bars taken back by "Ångra": the next rolls replay them in order
  const OLD_KEYS = ['slumpad-barrunda:forra', 'slumpad-barrunda:last']; // single-step undo, replaced
  const MAX_HISTORY = 200;

  const app = document.querySelector('[data-app]');
  if (!app) return;
  const source = app.dataset.barer || 'barer.json';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel) => app.querySelector(sel);
  const el = {
    views: app.querySelectorAll('[data-view]'),
    name: $('[data-name]'),
    address: $('[data-address]'),
    final: $('[data-final]'),
    map: $('[data-map]'),
    progress: $('[data-progress]'),
    stops: app.querySelectorAll('[data-stop]'),
    totals: app.querySelectorAll('[data-total]'),
    status: $('[data-status]'),
    errorTitle: $('[data-error-title]'),
    errorText: $('[data-error-text]'),
    next: $('[data-next]'),
    reset: $('[data-reset]'),
    undo: $('[data-undo]'),
    retry: $('[data-retry]'),
  };

  let bars = [];
  let roundLen = 0; // stops per round ("antal" in barer.json, last bar included); defaults to every bar
  let visited = [];
  let current = null;
  let history = []; // { visited, current } before each pick, newest last; "Ångra" pops one
  let queue = []; // bars taken back by "Ångra", next first; undo + roll again replays them, so undo can't be used to re-pick
  let busy = false;

  /* ---------- storage: never throws, works in memory if blocked ---------- */
  const store = {
    read(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    write(key, value) {
      try { window.localStorage.setItem(key, value); } catch { /* memory only */ }
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch { /* memory only */ }
    },
  };

  function loadHistory() {
    const names = new Set(bars.map((b) => b.namn));
    let saved = [];
    try {
      const parsed = JSON.parse(store.read(KEY_VISITED) || '[]');
      if (Array.isArray(parsed)) saved = parsed;
    } catch { saved = []; }
    // Drop names that are no longer in the list, and duplicates.
    visited = [...new Set(saved.filter((n) => typeof n === 'string' && names.has(n)))];
    const cur = store.read(KEY_CURRENT);
    current = cur && names.has(cur) ? cur : null;

    const known = (n) => typeof n === 'string' && names.has(n);
    history = [];
    try {
      const h = JSON.parse(store.read(KEY_HISTORY) || '[]');
      if (Array.isArray(h)) {
        history = h
          .filter((s) => s && Array.isArray(s.visited))
          .map((s) => ({ visited: [...new Set(s.visited.filter(known))], current: known(s.current) ? s.current : null }))
          .slice(-MAX_HISTORY);
      }
    } catch { history = []; }

    queue = [];
    try {
      const q = JSON.parse(store.read(KEY_QUEUE) || '[]');
      if (Array.isArray(q)) queue = q.filter(known);
    } catch { queue = []; }
  }

  function saveHistory() {
    store.write(KEY_VISITED, JSON.stringify(visited));
    if (current) store.write(KEY_CURRENT, current);
    else store.remove(KEY_CURRENT);
    if (history.length) store.write(KEY_HISTORY, JSON.stringify(history));
    else store.remove(KEY_HISTORY);
    if (queue.length) store.write(KEY_QUEUE, JSON.stringify(queue));
    else store.remove(KEY_QUEUE);
    OLD_KEYS.forEach((k) => store.remove(k));
  }

  /* ---------- the list ---------- */
  // barer.json is either a plain array of bars, or { "antal": 4, "barer": [...] } for a fixed round length.
  function parseList(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.barer) ? data.barer : [];
    bars = parseBars(list);
    const antal = data && !Array.isArray(data) ? Number(data.antal) : NaN;
    roundLen = Number.isInteger(antal) && antal > 0 ? Math.min(antal, bars.length) : bars.length;
    // With a last bar, the round must have room for it plus at least one other stop when there are others.
    if (bars.some((b) => b.sist) && bars.length > 1) roundLen = Math.max(roundLen, 2);
  }

  function parseBars(data) {
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    let hasFinal = false;
    for (const item of data) {
      if (!item || typeof item.namn !== 'string') continue;
      const namn = item.namn.trim();
      if (!namn || seen.has(namn)) continue;
      seen.add(namn);
      const adress = typeof item.adress === 'string' ? item.adress.trim() : '';
      const karta = typeof item.karta === 'string' && /^https?:\/\//i.test(item.karta.trim()) ? item.karta.trim() : '';
      // "sist": true marks the shared last bar of the night; only the first one marked counts.
      const sist = item.sist === true && !hasFinal;
      if (sist) hasFinal = true;
      out.push({ namn, adress, karta, sist });
    }
    return out;
  }

  const byName = (name) => bars.find((b) => b.namn === name) || null;

  function mapUrl(bar) {
    if (bar.karta) return bar.karta;
    const q = bar.adress ? `${bar.namn}, ${bar.adress}` : bar.namn;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  /* ---------- randomness ---------- */
  function randomInt(n) {
    if (n <= 1) return 0;
    const c = window.crypto;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n; // reject to avoid modulo bias
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function pickNext() {
    history.push({ visited: visited.slice(), current });
    if (history.length > MAX_HISTORY) history.shift();
    const final = bars.find((b) => b.sist) || null;
    const roundOver = visited.length >= roundLen || (final && visited.includes(final.namn));
    let pool;
    if (roundOver) {
      // Round complete: start a new one silently, but never repeat the bar just shown.
      visited = [];
      pool = bars.filter((b) => b.namn !== current);
      if (!pool.length) pool = bars.slice();
    } else {
      pool = bars.filter((b) => !visited.includes(b.namn));
    }
    // The bar marked "sist" is always the round's last stop, so the night ends there for everyone.
    // The other stops are drawn from the rest of the list (the pool), as many as "antal" leaves room for.
    if (final && visited.length === roundLen - 1) {
      pool = [final];
    } else {
      const others = pool.filter((b) => !b.sist);
      if (others.length) pool = others;
    }
    // After an undo, rolls replay the bars that were taken back, in order, so undoing can't be used to shop for a bar.
    let bar = null;
    while (!bar && queue.length) {
      const name = queue.shift();
      bar = pool.find((b) => b.namn === name) || null;
    }
    if (!bar) bar = pool[randomInt(pool.length)];
    visited.push(bar.namn);
    current = bar.namn;
    saveHistory();
    return bar;
  }

  /* ---------- rendering ---------- */
  function show(state) {
    app.dataset.state = state;
    el.views.forEach((v) => { v.hidden = v.dataset.view !== state; });
    const ready = (state === 'empty' || state === 'full') && !busy;
    el.next.disabled = !ready;
    el.reset.disabled = !ready || visited.length === 0;
    if (el.undo) el.undo.disabled = !ready || history.length === 0;
  }

  function sizeFor(name) {
    const longestWord = Math.max(...name.split(/\s+/).map((w) => w.length));
    if (name.length > 22 || longestWord > 11) return 's';
    if (name.length > 12 || longestWord > 8) return 'm';
    return 'l';
  }

  function setName(text, sizeFrom = text) {
    el.name.textContent = text;
    el.name.dataset.size = sizeFor(sizeFrom);
  }

  // Scrambled letters shown while rolling, so the roll never reveals which bars are in the list.
  const SCRAMBLE = 'ABCDEFGHIJKLMNOPRSTUVXYZÅÄÖ';
  function scramble() {
    const len = 6 + randomInt(5); // 6 to 10 letters, unrelated to any real name
    let out = '';
    for (let i = 0; i < len; i++) out += SCRAMBLE[randomInt(SCRAMBLE.length)];
    return out;
  }

  function renderProgress() {
    const n = roundLen;
    if (el.progress) el.progress.textContent = n ? `${visited.length} av ${n} besökta` : '';
    const pos = current ? visited.indexOf(current) + 1 : 0;
    const stop = String(pos || visited.length);
    el.stops.forEach((s) => { s.textContent = stop; });
    el.totals.forEach((t) => { t.textContent = String(n); });
  }

  function renderBar(bar) {
    setName(bar.namn);
    el.address.textContent = bar.adress;
    el.address.hidden = !bar.adress;
    if (el.final) el.final.hidden = !bar.sist;
    el.map.href = mapUrl(bar);
    el.map.setAttribute('aria-label', `Visa ${bar.namn} på karta (öppnas i ny flik)`);
    renderProgress();
    show('full');
  }

  function land(bar) {
    renderBar(bar);
    el.status.textContent = `Nästa bar: ${bar.namn}${bar.adress ? ', ' + bar.adress : ''}.${bar.sist ? ' Kvällens sista bar!' : ''}`;
    app.classList.remove('is-landed', 'is-rewound');
    void app.offsetWidth; // restart the landing animation
    app.classList.add('is-landed');
    app.dispatchEvent(new CustomEvent('barrunda:landed', { detail: { namn: bar.namn } }));
  }

  function shuffleTo(bar) {
    const steps = [45, 50, 50, 55, 60, 70, 80, 95, 115, 140];
    let i = 0;
    show('full');
    app.classList.remove('is-landed', 'is-rewound');
    app.classList.add('is-shuffling');
    app.dispatchEvent(new CustomEvent('barrunda:roll'));
    el.address.hidden = true;
    const tick = () => {
      if (i >= steps.length) {
        app.classList.remove('is-shuffling');
        busy = false;
        el.next.removeAttribute('aria-busy');
        land(bar);
        return;
      }
      setName(scramble(), 'XXXXXXXXXX');
      app.dataset.tick = String(i % 2);
      setTimeout(tick, steps[i++]);
    };
    tick();
  }

  function onNext() {
    if (busy || bars.length === 0) return;
    const bar = pickNext();
    if (reduceMotion.matches) { land(bar); return; }
    busy = true;
    el.next.setAttribute('aria-busy', 'true');
    shuffleTo(bar);
  }

  // Take back the last pick (e.g. an accidental double tap): the bar returns to the unvisited pool.
  function onUndo() {
    if (busy || history.length === 0) return;
    if (current) queue.unshift(current); // the bar being taken back comes up again on the next roll
    const snapshot = history.pop();
    visited = snapshot.visited;
    current = snapshot.current;
    saveHistory();
    const bar = current && byName(current);

    const finish = () => {
      busy = false;
      el.next.removeAttribute('aria-busy');
      app.classList.remove('is-rewinding', 'is-landed', 'is-rewound');
      if (bar) {
        renderBar(bar);
        el.status.textContent = `Ångrat. Tillbaka till ${bar.namn}.`;
      } else {
        renderProgress();
        show('empty');
        el.status.textContent = 'Ångrat.';
      }
      void app.offsetWidth; // restart the rewind-settle animation
      app.classList.add('is-rewound');
      app.dispatchEvent(new CustomEvent('barrunda:undo'));
    };

    if (reduceMotion.matches) { finish(); return; }

    // A quick rewind: the coaster spins backwards under scrambled letters, then settles on the old bar.
    busy = true;
    el.next.setAttribute('aria-busy', 'true');
    app.classList.remove('is-landed', 'is-rewound');
    app.classList.add('is-rewinding');
    app.dispatchEvent(new CustomEvent('barrunda:rewind'));
    show('full');
    const steps = [40, 40, 45, 50, 60, 75];
    let i = 0;
    const tick = () => {
      if (i >= steps.length) { finish(); return; }
      setName(scramble(), 'XXXXXXXXXX');
      setTimeout(tick, steps[i++]);
    };
    tick();
  }

  function onReset() {
    if (busy) return;
    if (!window.confirm('Vill du börja om? Alla besökta barer glöms bort.')) return;
    visited = [];
    current = null;
    history = []; // the replay queue stays, so "Börja om" can't be used to re-pick either
    saveHistory();
    renderProgress();
    el.status.textContent = 'Historiken är rensad.';
    show('empty');
  }

  function fail(title, text) {
    el.errorTitle.textContent = title;
    el.errorText.textContent = text;
    show('error');
  }

  async function load() {
    show('loading');
    try {
      const res = await fetch(source, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      parseList(await res.json());
    } catch {
      fail('Barlistan gick inte att läsa', 'Kolla att du har uppkoppling och försök igen.');
      return;
    }
    if (bars.length === 0) {
      fail('Barlistan är tom', 'Lägg till barer i barer.json och ladda om sidan.');
      return;
    }
    loadHistory();
    renderProgress();
    const bar = current && byName(current);
    if (bar) renderBar(bar);
    else show('empty');
  }

  el.next.addEventListener('click', onNext);
  el.reset.addEventListener('click', onReset);
  if (el.undo) el.undo.addEventListener('click', onUndo);
  if (el.retry) el.retry.addEventListener('click', load);

  load();
})();
