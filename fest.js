/* Party effects: a confetti burst and a "Skål!" when a bar lands. Pure decoration, never blocks the app. */
(() => {
  'use strict';

  const app = document.querySelector('[data-app]');
  if (!app) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PIECES = 46;
  const COLOURS = 5; // .confetti__piece--c1 … --c5, colours live in style.css tokens

  let layer = null;
  function getLayer() {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'confetti';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  const rand = (min, max) => min + Math.random() * (max - min);

  function burst() {
    const coaster = app.querySelector('.coaster');
    if (!coaster) return;
    const box = coaster.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const reach = Math.max(window.innerWidth, 320) * 0.6;
    const root = getLayer();
    const frag = document.createDocumentFragment();

    for (let i = 0; i < PIECES; i++) {
      const p = document.createElement('span');
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0.35, 1) * reach;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist * 0.75 - rand(40, 140); // throw upward a bit
      p.className = `confetti__piece confetti__piece--c${1 + (i % COLOURS)}${i % 3 === 0 ? ' confetti__piece--dot' : ''}`;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--x', `${x.toFixed(1)}px`);
      p.style.setProperty('--y1', `${y.toFixed(1)}px`);
      p.style.setProperty('--y2', `${(y + rand(160, 320)).toFixed(1)}px`);
      p.style.setProperty('--r', `${Math.round(rand(-540, 540))}deg`);
      p.style.setProperty('--d', `${Math.round(rand(900, 1400))}ms`);
      frag.appendChild(p);
    }

    const skal = document.createElement('span');
    skal.className = 'skal';
    skal.textContent = 'Skål!';
    skal.style.left = `${cx}px`;
    skal.style.top = `${box.top + box.height * 0.12}px`;
    frag.appendChild(skal);

    window.clearTimeout(cleanup);
    root.replaceChildren(frag);
    cleanup = window.setTimeout(() => root.replaceChildren(), 1600);
  }
  let cleanup = 0;

  app.addEventListener('barrunda:landed', () => {
    if (reduceMotion.matches) return;
    burst();
  });
})();
