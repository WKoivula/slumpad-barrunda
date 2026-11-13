/* Slumpad barrunda: picks a random bar, never repeats until all are visited. */
(() => {
  'use strict';

  const KEY_VISITED = 'slumpad-barrunda:besokta';
  const KEY_CURRENT = 'slumpad-barrunda:aktuell';

  const app = document.querySelector('[data-app]');
  if (!app) return;
  const source = app.dataset.barer || 'barer.json';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel) => app.querySelector(sel);
  const el = {
    views: app.querySelectorAll('[data-view]'),
    name: $('[data-name]'),
    address: $('[data-address]'),
    map: $('[data-map]'),
    progress: $('[data-progress]'),
    stops: app.querySelectorAll('[data-stop]'),
    totals: app.querySelectorAll('[data-total]'),
    status: $('[data-status]'),
    errorTitle: $('[data-error-title]'),
    errorText: $('[data-error-text]'),
    next: $('[data-next]'),
    reset: $('[data-reset]'),
    retry: $('[data-retry]'),
  };

  let bars = [];
  let visited = [];
  let current = null;
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
  }

  function saveHistory() {
    store.write(KEY_VISITED, JSON.stringify(visited));
    if (current) store.write(KEY_CURRENT, current);
    else store.remove(KEY_CURRENT);
  }

  /* ---------- the list ---------- */
  function parseBars(data) {
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    for (const item of data) {
      if (!item || typeof item.namn !== 'string') continue;
      const namn = item.namn.trim();
      if (!namn || seen.has(namn)) continue;
      seen.add(namn);
      const adress = typeof item.adress === 'string' ? item.adress.trim() : '';
      const karta = typeof item.karta === 'string' && /^https?:\/\//i.test(item.karta.trim()) ? item.karta.trim() : '';
      out.push({ namn, adress, karta });
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
    let pool = bars.filter((b) => !visited.includes(b.namn));
    if (pool.length === 0) {
      // Every bar visited: start a new round silently, but never repeat the bar just shown.
      visited = [];
      pool = bars.length > 1 ? bars.filter((b) => b.namn !== current) : bars.slice();
    }
    const bar = pool[randomInt(pool.length)];
    visited.push(bar.namn);
    current = bar.namn;
    saveHistory();
    return bar;
  }

  /* ---------- rendering ---------- */
  function show(state) {
    app.dataset.state = state;
    el.views.forEach((v) => { v.hidden = v.dataset.view !== state; });
    const ready = state === 'empty' || state === 'full';
    el.next.disabled = !ready;
    el.reset.disabled = !ready || visited.length === 0;
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
    const n = bars.length;
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
    el.map.href = mapUrl(bar);
    el.map.setAttribute('aria-label', `Visa ${bar.namn} på karta (öppnas i ny flik)`);
    renderProgress();
    show('full');
  }

  function land(bar) {
    renderBar(bar);
    el.status.textContent = `Nästa bar: ${bar.namn}${bar.adress ? ', ' + bar.adress : ''}.`;
    app.classList.remove('is-landed');
    void app.offsetWidth; // restart the landing animation
    app.classList.add('is-landed');
  }

  function shuffleTo(bar) {
    const steps = [45, 50, 50, 55, 60, 70, 80, 95, 115, 140];
    let i = 0;
    show('full');
    app.classList.remove('is-landed');
    app.classList.add('is-shuffling');
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
    el.next.disabled = true;
    el.reset.disabled = true;
    shuffleTo(bar);
  }

  function onReset() {
    if (busy) return;
    if (!window.confirm('Vill du börja om? Alla besökta barer glöms bort.')) return;
    visited = [];
    current = null;
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
      bars = parseBars(await res.json());
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
  if (el.retry) el.retry.addEventListener('click', load);

  load();
})();
