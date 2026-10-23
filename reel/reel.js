/* Trust+ billing reel: the fee mechanism as a short, wordless motion piece.
   Live mode: the presenter clicks (or presses →) for every human action.
   Auto mode: a cursor performs the actions and scenes advance on their own.
   No backend and no network: everything here is the Alpina / SinoGear fixture. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ setup
  const stage = document.getElementById('stage');
  const root = document.getElementById('root');
  const railEl = document.getElementById('rail');
  const cursorEl = document.getElementById('cursor');
  const fxCanvas = document.getElementById('fx');
  const nextHint = document.getElementById('next-hint');
  const dotsEl = document.getElementById('dots');
  const modeBtn = document.getElementById('mode-btn');
  const soundBtn = document.getElementById('sound-btn');
  const splash = document.getElementById('splash');

  const params = new URLSearchParams(location.search);
  const S = {
    i: -1,
    mode: params.has('live') ? 'live' : 'auto',
    sound: !params.has('mute'),
    speed: Math.max(0.25, Number(params.get('speed')) || 1),
    token: 0,
    timers: [],
    pending: null,
    done: false,
    started: false,
    scale: 1,
  };

  function fit() {
    S.scale = Math.min(innerWidth / 1600, innerHeight / 900);
    stage.style.transform = `translate(-50%, -50%) scale(${S.scale})`;
  }
  addEventListener('resize', fit);
  fit();

  // ------------------------------------------------------------------ helpers
  const $ = (sel, scope = root) => scope.querySelector(sel);
  const $$ = (sel, scope = root) => [...scope.querySelectorAll(sel)];
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const chf = (n) => 'CHF ' + num(n);
  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    in: (t) => t * t * t,
  };

  // Every timer belongs to the current scene; leaving a scene makes its promises go quiet.
  function wait(ms) {
    const tok = S.token;
    return new Promise((res) => {
      S.timers.push(setTimeout(() => { if (tok === S.token) res(); }, ms / S.speed));
    });
  }
  function later(ms, fn) {
    const tok = S.token;
    S.timers.push(setTimeout(() => { if (tok === S.token) fn(); }, ms / S.speed));
  }
  function loop(fn) {
    const tok = S.token;
    let last = performance.now();
    const step = (now) => {
      if (tok !== S.token) return;
      const dt = Math.min(0.05, (now - last) / 1000) * S.speed;
      last = now;
      if (fn(dt) === false) return;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function tween(ms, fn, e = ease.out) {
    const tok = S.token;
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        if (tok !== S.token) return;
        const p = Math.min(1, ((now - t0) * S.speed) / ms);
        fn(e(p));
        if (p < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }
  function countUp(el, to, { from = 0, ms = 900, fmt = chf } = {}) {
    return tween(ms, (p) => { el.textContent = fmt(from + (to - from) * p); });
  }
  async function typeText(el, text, { cps = 40, sound = true } = {}) {
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      if (sound && i % 2 === 0 && text[i] !== ' ') Sound.key();
      await wait(1000 / cps);
    }
  }
  function sigPath(seed, w = 200, hgt = 60) {
    let s = seed * 9301 + 49297;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let x = 6;
    let y = hgt * 0.62;
    let d = `M${x} ${y}`;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const nx = x + (w / n) * (0.75 + r() * 0.5);
      const ny = hgt * (0.2 + r() * 0.6);
      const c1x = x + (nx - x) * 0.25 + (r() - 0.5) * 24;
      const c1y = Math.max(0, Math.min(hgt, y + (r() - 0.5) * hgt * 1.3));
      const c2x = x + (nx - x) * 0.75 + (r() - 0.5) * 24;
      const c2y = Math.max(0, Math.min(hgt, ny + (r() - 0.5) * hgt * 1.3));
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
      x = nx;
      y = ny;
    }
    d += ` M${(w * 0.12).toFixed(1)} ${(hgt * 0.92).toFixed(1)} C${(w * 0.4).toFixed(1)} ${hgt} ${(w * 0.7).toFixed(1)} ${(hgt * 0.84).toFixed(1)} ${(w * 0.98).toFixed(1)} ${(hgt * 0.8).toFixed(1)}`;
    return d;
  }
  async function drawSig(svg, seed, ms = 800) {
    const box = svg.getBoundingClientRect();
    const w = box.width / S.scale;
    const hgt = box.height / S.scale;
    svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', sigPath(seed, w - 10, hgt - 8));
    svg.appendChild(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    Sound.scribble(ms / 1000);
    await tween(ms, (t) => { p.style.strokeDashoffset = len * (1 - t); }, ease.inOut);
  }
  function flash() {
    const f = h('<div class="flash"></div>');
    stage.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  // ------------------------------------------------------------------ icons
  const P = {
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor" stroke="none"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grip: '<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    book: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    chain: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    scale: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.8 2.8 0 0 0 5 0zM19 7l-2.5 6a2.8 2.8 0 0 0 5 0z"/>',
    lockS: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
  };
  const I = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
  const LOCK = `<svg class="lock" viewBox="0 0 48 48"><path class="shackle" d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><rect x="10" y="21" width="28" height="21" rx="5" fill="rgba(139,92,246,.25)" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="31" r="3" fill="currentColor"/></svg>`;

  // ------------------------------------------------------------------ sound (synthesised, no files)
  const Sound = (() => {
    let ac = null;
    let master = null;
    function ctx() {
      if (!S.sound) return null;
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.55;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, { type = 'sine', dur = 0.3, vol = 0.2, attack = 0.006, delay = 0, slide = 0 } = {}) {
      const a = ctx();
      if (!a) return;
      const t = a.currentTime + delay;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    function noise({ dur = 0.3, vol = 0.15, delay = 0, freq = 1200, q = 0.8, sweep = 0, attack = 0.01 } = {}) {
      const a = ctx();
      if (!a) return;
      const t = a.currentTime + delay;
      const len = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }
    const ding = (f, d = 0, v = 0.2) => {
      tone(f, { dur: 1.4, vol: v, delay: d });
      tone(f * 2, { dur: 0.7, vol: v * 0.25, delay: d });
      tone(f * 3.01, { dur: 0.35, vol: v * 0.08, delay: d });
    };
    return {
      unlock: () => ctx(),
      key: () => tone(1500 + Math.random() * 500, { type: 'triangle', dur: 0.03, vol: 0.025 }),
      tick: () => tone(2200, { type: 'sine', dur: 0.05, vol: 0.04 }),
      click: () => { tone(900, { type: 'triangle', dur: 0.05, vol: 0.06 }); noise({ dur: 0.04, vol: 0.05, freq: 4000 }); },
      blip: (f = 880) => tone(f, { dur: 0.16, vol: 0.09, slide: 1.25 }),
      hop: () => tone(260 + Math.random() * 60, { type: 'sine', dur: 0.09, vol: 0.07, slide: 1.6 }),
      pop: () => tone(420, { dur: 0.18, vol: 0.14, slide: 2.4 }),
      whoosh: (d = 0) => noise({ dur: 0.9, vol: 0.16, freq: 300, sweep: 8, q: 0.6, attack: 0.25, delay: d }),
      splash: () => { noise({ dur: 1.4, vol: 0.22, freq: 180, sweep: 14, q: 0.5, attack: 0.08 }); tone(110, { dur: 1.2, vol: 0.18, slide: 0.5 }); ding(659.25, 0.35, 0.08); },
      swell: (dur = 1.4) => { tone(180, { type: 'sawtooth', dur, vol: 0.035, slide: 4, attack: dur * 0.8 }); noise({ dur, vol: 0.08, freq: 400, sweep: 10, attack: dur * 0.9 }); },
      boom: () => { tone(70, { dur: 0.7, vol: 0.35, slide: 0.6 }); noise({ dur: 0.5, vol: 0.12, freq: 800, sweep: 0.3 }); },
      seal: () => { tone(520, { type: 'square', dur: 0.08, vol: 0.04 }); tone(390, { type: 'square', dur: 0.12, vol: 0.04, delay: 0.09 }); },
      unlockS: () => { tone(300, { type: 'triangle', dur: 0.5, vol: 0.12, slide: 3 }); noise({ dur: 0.2, vol: 0.1, freq: 3000, delay: 0.05 }); ding(1046.5, 0.35, 0.1); },
      ok: () => { tone(784, { dur: 0.25, vol: 0.1 }); tone(1174.7, { dur: 0.4, vol: 0.1, delay: 0.09 }); },
      alert: () => { tone(880, { type: 'square', dur: 0.12, vol: 0.05 }); tone(660, { type: 'square', dur: 0.16, vol: 0.05, delay: 0.14 }); },
      dingding: (d = 0) => { ding(1318.5, d, 0.2); ding(1760, d + 0.2, 0.2); },
      stamp: () => { tone(120, { dur: 0.25, vol: 0.45, slide: 0.45 }); noise({ dur: 0.12, vol: 0.22, freq: 1800, q: 0.5 }); },
      cash: () => { noise({ dur: 0.06, vol: 0.12, freq: 5000 }); ding(2093, 0.03, 0.08); ding(2637, 0.11, 0.08); },
      scribble: (dur = 0.8) => { for (let i = 0; i < 6; i++) noise({ dur: dur / 6, vol: 0.05, freq: 2600 + Math.random() * 1600, q: 2, delay: (i * dur) / 6 }); },
      win: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.6, vol: 0.16, delay: i * 0.09 }));
        [523.25, 659.25, 783.99].forEach((f) => tone(f * 2, { type: 'sine', dur: 1.6, vol: 0.06, delay: 0.42 }));
        ding(1318.5, 0.5, 0.2);
        ding(1760, 0.72, 0.2);
        for (let i = 0; i < 10; i++) tone(2000 + Math.random() * 2500, { dur: 0.15, vol: 0.03, delay: 0.5 + Math.random() * 1.2 });
      },
      chord: () => { [261.6, 329.6, 392, 523.25].forEach((f, i) => tone(f, { type: 'sine', dur: 2.6, vol: 0.08, delay: i * 0.05, attack: 0.3 })); ding(1046.5, 0.3, 0.1); },
    };
  })();

  // ------------------------------------------------------------------ confetti (outlives scene changes)
  const FX = (() => {
    const c = fxCanvas.getContext('2d');
    c.scale(2, 2);
    let parts = [];
    let running = false;
    let last = 0;
    const colors = ['#00338d', '#005eb8', '#0091da', '#00b8f5', '#7213ea', '#00a3a1', '#fd349c', '#f6c96b'];
    function burst(x, y, n, angle, spread, power) {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = power * (0.55 + Math.random() * 0.6);
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
          w: 6 + Math.random() * 7, h: 9 + Math.random() * 9,
          color: colors[(Math.random() * colors.length) | 0],
          life: 0, ttl: 2.6 + Math.random() * 1.8, round: Math.random() < 0.25,
        });
      }
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
    }
    function step(now) {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      c.clearRect(0, 0, 1600, 900);
      parts = parts.filter((p) => p.life < p.ttl && p.y < 980);
      for (const p of parts) {
        p.life += dt;
        p.vy += 980 * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        c.save();
        c.globalAlpha = Math.max(0, 1 - Math.max(0, p.life - p.ttl + 0.6) / 0.6);
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        if (p.round) { c.beginPath(); c.arc(0, 0, p.w / 2, 0, 6.29); c.fill(); }
        else c.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.rot * 0.7)), p.w, p.h * Math.abs(Math.cos(p.rot * 0.7)) + 1);
        c.restore();
      }
      if (parts.length) requestAnimationFrame(step);
      else { running = false; c.clearRect(0, 0, 1600, 900); }
    }
    return {
      celebrate() {
        burst(60, 900, 140, -Math.PI / 3, 0.7, 1500);
        burst(1540, 900, 140, (-2 * Math.PI) / 3, 0.7, 1500);
        setTimeout(() => burst(800, 380, 160, -Math.PI / 2, Math.PI * 2, 900), 250);
      },
      small(x, y) { burst(x, y, 40, -Math.PI / 2, Math.PI * 1.2, 650); },
    };
  })();

  // ------------------------------------------------------------------ fake cursor + actions
  const Cursor = {
    shown: false,
    x: 1300,
    y: 760,
    centerOf(el) {
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - s.left) / S.scale, y: (r.top + r.height / 2 - s.top) / S.scale };
    },
    place(x, y, ms) {
      cursorEl.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,0,.2,1)` : 'none';
      cursorEl.style.transform = `translate(${x - 5}px, ${y - 3}px)`;
      this.x = x;
      this.y = y;
    },
    async moveTo(el, ms, who) {
      const p = this.centerOf(el);
      cursorEl.querySelector('.who').textContent = who;
      if (!this.shown) {
        this.place(Math.min(1560, p.x + 260), Math.min(880, p.y + 170), 0);
        void cursorEl.offsetWidth;
        cursorEl.classList.add('on');
        this.shown = true;
      }
      clearTimeout(this.idle);
      this.place(p.x, p.y, ms / S.speed);
      await wait(ms);
    },
    click() {
      cursorEl.classList.remove('click');
      void cursorEl.offsetWidth;
      cursorEl.classList.add('click');
      clearTimeout(this.idle);
      this.idle = setTimeout(() => { if (!S.pending) this.hide(); }, 1300 / S.speed);
    },
    hide() {
      cursorEl.classList.remove('on');
      this.shown = false;
    },
  };

  // Wait for a human action on `el`. Live: the presenter clicks it (or presses →).
  // Auto: the cursor travels there and clicks.
  function act(target, who = 'Lea') {
    const el = typeof target === 'string' ? $(target) : target;
    const tok = S.token;
    return new Promise((resolve) => {
      let finished = false;
      const pending = { busy: false, fire: null };
      const finish = () => {
        if (finished || tok !== S.token) return;
        finished = true;
        el.classList.remove('await');
        if (S.pending === pending) S.pending = null;
        Sound.click();
        resolve();
      };
      el.addEventListener('click', finish, { once: true });
      el.classList.add('await');
      pending.fire = async (fast) => {
        if (pending.busy || finished) return;
        pending.busy = true;
        await Cursor.moveTo(el, fast ? 300 : 760, who);
        if (finished || tok !== S.token) return;
        Cursor.click();
        el.click();
      };
      S.pending = pending;
      if (S.mode === 'auto') later(700, () => pending.fire(false));
    });
  }

  // ------------------------------------------------------------------ scenes
  const SCENES = [];
  const scene = (def) => SCENES.push(def);

  // 0 · Intro: the AI crawls in, says hi, and spreads like ink into the product.
  scene({
    id: 'intro', title: 'Hi', side: '', noChrome: true, hold: 0,
    async run() {
      document.getElementById('intro')?.remove();
      const intro = h(`
        <div id="intro">
          <svg class="ink" viewBox="0 0 1600 900" preserveAspectRatio="none">
            <defs>
              <filter id="goo" filterUnits="userSpaceOnUse" x="-200" y="-200" width="2000" height="1300">
                <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="b"/>
                <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/>
              </filter>
              <radialGradient id="inkGrad" gradientUnits="userSpaceOnUse" cx="700" cy="450" r="1100">
                <stop offset="0" stop-color="#e6f6ff"/>
                <stop offset=".25" stop-color="#00b8f5"/>
                <stop offset=".6" stop-color="#005eb8"/>
                <stop offset="1" stop-color="#00338d"/>
              </radialGradient>
              <mask id="holeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="900">
                <rect width="1600" height="900" fill="#fff"/>
                <g id="gHole" filter="url(#goo)" fill="#000"></g>
              </mask>
              <mask id="ringMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="900">
                <rect width="1600" height="900" fill="#000"/>
                <g id="gRing" filter="url(#goo)" fill="#fff"></g>
                <g id="gInner" filter="url(#goo)" fill="#000"></g>
              </mask>
            </defs>
            <rect width="1600" height="900" fill="#000" mask="url(#holeMask)"/>
            <rect width="1600" height="900" fill="url(#inkGrad)" mask="url(#ringMask)"/>
          </svg>
          <div class="orb"><i class="eye l"></i><i class="eye r"></i></div>
          <div class="hi"><span class="txt"></span><span class="caret"></span></div>
          <div class="hi-sub">I do the work. Your people make the call.</div>
        </div>`);
      stage.appendChild(intro);
      const orb = intro.querySelector('.orb');

      // Inchworm crawl: stretch, pull, hop, six times.
      const x0 = -90;
      const x1 = 700;
      const y = 450;
      const hops = 6;
      const step = (x1 - x0) / hops;
      const frames = [];
      for (let j = 0; j < hops; j++) {
        const x = x0 + j * step;
        frames.push({ offset: j / hops, transform: `translate(${x}px, ${y}px) scale(1, 1)`, easing: 'cubic-bezier(.5,0,.5,1)' });
        frames.push({ offset: (j + 0.45) / hops, transform: `translate(${x + step * 0.3}px, ${y + 2}px) scale(1.32, .78)`, easing: 'cubic-bezier(.5,0,.5,1)' });
        frames.push({ offset: (j + 0.8) / hops, transform: `translate(${x + step * 0.92}px, ${y - 9}px) scale(.86, 1.14)`, easing: 'cubic-bezier(.5,0,.5,1)' });
      }
      frames.push({ offset: 1, transform: `translate(${x1}px, ${y}px) scale(1, 1)` });
      const crawlMs = 2100 / S.speed;
      orb.animate(frames, { duration: crawlMs, fill: 'forwards' });
      for (let j = 0; j < hops; j++) later((j + 0.8) * (2100 / hops), () => Sound.hop());
      let acc = 0;
      loop((dt) => {
        acc += dt;
        if (acc > 0.04) {
          acc = 0;
          const m = new DOMMatrix(getComputedStyle(orb).transform);
          const d = h(`<div class="trail" style="left:${m.m41}px;top:${m.m42 + 6}px"></div>`);
          intro.appendChild(d);
          setTimeout(() => d.remove(), 950);
        }
        return m41(orb) < x1 - 2;
      });
      await wait(2200);
      orb.animate([{ transform: `translate(${x1}px, ${y}px) scale(1)` }, { transform: `translate(${x1}px, ${y - 14}px) scale(1.08)` }, { transform: `translate(${x1}px, ${y}px) scale(1)` }], { duration: 420, fill: 'forwards' });
      Sound.pop();
      await wait(200);
      await typeText(intro.querySelector('.hi .txt'), 'Hi.', { cps: 7 });
      await wait(300);
      intro.querySelector('.hi-sub').classList.add('on');
      await wait(1300);
      inkReveal(intro, x1, y);
      go(1);
    },
  });
  function m41(el) { return new DOMMatrix(getComputedStyle(el).transform).m41; }

  // Paint spreads from the orb; the product shows through the ink.
  function inkReveal(intro, cx, cy) {
    intro.dataset.revealing = '1';
    const NS = 'http://www.w3.org/2000/svg';
    const groups = ['#gHole', '#gRing', '#gInner'].map((s) => intro.querySelector(s));
    const blobs = [];
    const add = (x, y, maxR, delay, dur, droplet) => {
      const cs = groups.map((g) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', x.toFixed(1));
        c.setAttribute('cy', y.toFixed(1));
        c.setAttribute('r', '0');
        g.appendChild(c);
        return c;
      });
      blobs.push({ maxR, delay, dur, cs, droplet });
    };
    add(cx, cy, 1950, 0, 1750);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 90 + Math.random() * 360;
      add(cx + Math.cos(a) * d * 1.6, cy + Math.sin(a) * d, 120 + Math.random() * 420, 80 + Math.random() * 420, 700 + Math.random() * 600);
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 260 + Math.random() * 760;
      add(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.62, 18 + Math.random() * 30, 30 + Math.random() * 260, 360, true);
    }
    const orb = intro.querySelector('.orb');
    const m = new DOMMatrix(getComputedStyle(orb).transform);
    orb.animate([{ transform: m.toString(), opacity: 1 }, { transform: `translate(${cx}px, ${cy}px) scale(4)`, opacity: 0 }], { duration: 500, fill: 'forwards', easing: 'ease-in' });
    intro.querySelectorAll('.hi, .hi-sub').forEach((n) => n.animate([{ opacity: 1 }, { opacity: 0, filter: 'blur(8px)' }], { duration: 350, fill: 'forwards' }));
    Sound.splash();
    const t0 = performance.now();
    const step = (now) => {
      const t = now - t0;
      let all = true;
      for (const b of blobs) {
        let p = (t - b.delay) / b.dur;
        if (p < 1) all = false;
        p = Math.max(0, Math.min(1, p));
        const e = b.droplet ? 1 - Math.pow(1 - p, 4) : (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
        const r = b.maxR * e;
        const ring = r > 0 ? r + Math.min(28, r * 0.4) : 0;
        b.cs[0].setAttribute('r', ring.toFixed(1));
        b.cs[1].setAttribute('r', ring.toFixed(1));
        b.cs[2].setAttribute('r', r.toFixed(1));
      }
      if (!all) requestAnimationFrame(step);
      else {
        intro.style.transition = 'opacity .35s';
        intro.style.opacity = '0';
        setTimeout(() => intro.remove(), 400);
      }
    };
    requestAnimationFrame(step);
  }


  // ------------------------------------------------------------------ reel kit
  const SPRING = 'cubic-bezier(.25,1.45,.4,1)';
  const OUT = 'cubic-bezier(.16,1,.3,1)';
  const IN = 'cubic-bezier(.6,0,.85,.25)';
  const anim = (el, kf, o = {}) => el.animate(kf, { duration: (o.d ?? 600) / S.speed, delay: (o.delay ?? 0) / S.speed, easing: o.e ?? OUT, fill: 'both' });
  const LC = { A: '#7213ea', B: '#0091da', C: '#00338d' };
  const RATE = { A: 1, B: 3, C: 8 };
  const COUNT = { A: 15, B: 10, C: 5 };
  const LANE_X = { A: 470, B: 800, C: 1130 };
  const rnd = (seed) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const LANE_OF = (() => {
    const a = [...'A'.repeat(15), ...'B'.repeat(10), ...'C'.repeat(5)];
    const r = rnd(7);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  })();
  const SCATTER = (() => { const r = rnd(5); return Array.from({ length: 30 }, () => ({ x: 150 + r() * 1300, y: 250 + r() * 520, rot: (r() - 0.5) * 80 })); })();
  const SLOTS = (() => {
    const seen = { A: 0, B: 0, C: 0 };
    return LANE_OF.map((l) => { const i = seen[l]++; return { x: LANE_X[l] - 106 + (i % 4) * 56, y: 744 - Math.floor(i / 4) * 56 }; });
  })();
  const ICON = {
    A: I('spark'),
    B: `${I('spark')}${I('user')}`,
    C: I('user'),
  };
  const Rail = { build() {}, apply() {} };

  function wipe() {
    const w = h(`<div class="wipe"><svg viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M9 17.5l4.2 4.2L23.5 11" fill="none" stroke="#00b8f5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`);
    stage.appendChild(w);
    Sound.whoosh();
    w.animate([{ transform: 'translateX(0) skewX(-10deg)' }, { transform: 'translateX(-125%) skewX(-10deg)' }], { duration: 700 / S.speed, easing: 'cubic-bezier(.75,0,.25,1)', fill: 'forwards' });
    setTimeout(() => w.remove(), 760 / S.speed);
  }
  const chap = (n, t) => `<div class="chap"><b>${n}</b>${t}</div>`;
  const letters = (word, cls = '') => `<span class="word ${cls}">${[...word].map((c, i) => `<i style="animation-delay:${i * 45}ms">${c}</i>`).join('')}</span>`;
  const tile = (x, y, extra = '') => `<div class="tile" style="left:${x}px;top:${y}px;${extra}"><i></i></div>`;
  const laneHTML = (l) => `
    <div class="lane" data-l="${l}" style="left:${LANE_X[l] - 130}px;--c:${LC[l]}">
      <div class="lbadge2">${l}</div>
      <div class="licon">${ICON[l]}</div>
      <div class="lrate"><b>${RATE[l]}k</b><span>per task</span></div>
      <div class="lcnt">0</div>
    </div>`;

  // 1 · The old way: hours.
  scene({
    id: 'hours', title: 'The old way', noChrome: true, hold: 1400, dur: 10500,
    async run(el) {
      el.innerHTML = `${chap('01', 'the old way')}
        <div class="clock" style="left:330px;top:250px">
          <svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="170" class="trk"/><circle cx="200" cy="200" r="170" class="arc"/><line x1="200" y1="200" x2="200" y2="62" class="hand"/><circle cx="200" cy="200" r="9" fill="#00338d"/></svg>
          <div class="cnum"><b id="hrs">0</b><span>hours</span></div>
        </div>
        <div class="money" style="left:840px;top:320px"><span class="cur">CHF</span><b id="rev">0</b><em id="delta"></em></div>`;
      const arc = $('.arc', el);
      const L = 2 * Math.PI * 170;
      arc.style.strokeDasharray = L;
      arc.style.strokeDashoffset = L;
      anim($('.clock', el), [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 700, e: SPRING });
      anim($('.money', el), [{ transform: 'translateX(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { d: 700, delay: 200 });
      await wait(300);
      tween(2000, (p) => { arc.style.strokeDashoffset = L * (1 - p); }, ease.inOut);
      countUp($('#hrs', el), 1100, { ms: 2000, fmt: num });
      await countUp($('#rev', el), 209000, { ms: 2000, fmt: num });
      Sound.cash();
      await wait(500);
      // the AI strikes
      const zap = h('<div class="zap"></div>');
      el.appendChild(zap);
      anim(zap, [{ transform: 'translate(-120px, 120px) scale(.6)' }, { transform: 'translate(500px, 400px) scale(1.2)' }], { d: 650, e: IN });
      await wait(640);
      zap.remove();
      flash();
      Sound.boom();
      anim($('.clock', el), [{ transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { d: 500, e: SPRING });
      tween(1100, (p) => { arc.style.strokeDashoffset = L * (0.73 * p); }, ease.out);
      countUp($('#hrs', el), 300, { from: 1100, ms: 1100, fmt: num });
      $('.money', el).classList.add('bad');
      await countUp($('#rev', el), 57000, { from: 209000, ms: 1100, fmt: num });
      $('#delta', el).textContent = '−73%';
      anim($('#delta', el), [{ transform: 'scale(0) rotate(-20deg)' }, { transform: 'scale(1) rotate(-6deg)' }], { d: 500, e: SPRING });
      Sound.alert();
      await wait(1500);
      // HOURS → TASKS
      anim($('.clock', el), [{ opacity: 1 }, { opacity: 0, transform: 'scale(.8)' }], { d: 400, e: IN });
      anim($('.money', el), [{ opacity: 1 }, { opacity: 0, transform: 'scale(.8)' }], { d: 400, e: IN });
      await wait(350);
      el.appendChild(h(`<div class="swapword"><div class="w1">${letters('HOURS')}<div class="strike"></div></div><div class="w2">${letters('TASKS', 'blue')}</div></div>`));
      Sound.pop();
      await wait(900);
      $('.strike', el).classList.add('on');
      Sound.alert();
      await wait(600);
      anim($('.w1', el), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(160px) rotate(6deg)', opacity: 0 }], { d: 600, e: IN });
      $('.w2', el).classList.add('on');
      Sound.ok();
      await wait(900);
    },
  });

  // 2 · Work splits into tasks.
  scene({
    id: 'tasks', title: 'Work → tasks', noChrome: true, hold: 900, dur: 5600,
    async run(el) {
      wipe();
      el.innerHTML = `${chap('02', 'work → tasks')}
        <div class="block" style="left:540px;top:330px;width:520px;height:300px"><div>${I('folder')}<span>1 engagement</span></div></div>
        <div class="bignum invisible"><b id="n">0</b><span>tasks</span></div>`;
      const block = $('.block', el);
      anim(block, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 800, e: SPRING, delay: 250 });
      await wait(1300);
      anim(block, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px) rotate(-1deg)' }, { transform: 'translateX(10px) rotate(1deg)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(0)' }], { d: 420, e: 'linear' });
      Sound.hop();
      await wait(420);
      anim(block, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.12)', opacity: 0 }], { d: 180, e: IN });
      flash();
      Sound.boom();
      SCATTER.forEach((p, k) => {
        const cx = 540 + ((k % 6) + 0.5) * (520 / 6) - 22;
        const cy = 330 + (Math.floor(k / 6) + 0.5) * 60 - 22;
        const t = h(tile(p.x, p.y, `transform:rotate(${p.rot}deg)`));
        el.appendChild(t);
        anim(t, [
          { transform: `translate(${cx - p.x}px, ${cy - p.y}px) scale(1.5)`, background: '#00338d', borderColor: '#00338d' },
          { transform: `rotate(${p.rot}deg)`, background: '#ffffff', borderColor: '#d6e0ee' },
        ], { d: 1000, delay: k * 10, e: OUT });
      });
      await wait(500);
      const bn = $('.bignum', el);
      bn.classList.remove('invisible');
      anim(bn, [{ transform: 'translate(-50%, 30px) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { d: 700, e: SPRING });
      await countUp($('#n', el), 30, { ms: 800, fmt: num });
      Sound.ok();
      await wait(600);
    },
  });

  // 3 · Each task drops into its HAAS lane.
  scene({
    id: 'lanes', title: 'Tasks → lanes', noChrome: true, hold: 1200, dur: 7200,
    async run(el) {
      wipe();
      el.innerHTML = `${chap('03', 'tasks → HAAS lanes')}${['A', 'B', 'C'].map(laneHTML).join('')}
        ${SCATTER.map((p) => tile(p.x, p.y, `transform:rotate(${p.rot}deg)`)).join('')}`;
      $$('.lane', el).forEach((ln, i) => anim(ln, [{ transform: 'translateY(720px)' }, { transform: 'none' }], { d: 900, delay: 300 + i * 140, e: SPRING }));
      await wait(1500);
      const tiles = $$('.tile', el);
      const cnt = { A: 0, B: 0, C: 0 };
      tiles.forEach((t, k) => {
        const p = SCATTER[k];
        const s = SLOTS[k];
        const l = LANE_OF[k];
        t.style.left = `${s.x}px`;
        t.style.top = `${s.y}px`;
        t.style.transform = 'none';
        t.style.setProperty('--c', LC[l]);
        t.classList.add('in');
        anim(t, [
          { transform: `translate(${p.x - s.x}px, ${p.y - s.y}px) rotate(${p.rot}deg)`, background: '#ffffff', borderColor: '#d6e0ee' },
          { transform: `translate(0, -40px) rotate(0)`, offset: 0.7 },
          { transform: 'none', background: LC[l], borderColor: LC[l] },
        ], { d: 850, delay: k * 70, e: 'cubic-bezier(.45,0,.2,1)' });
        later(k * 70 + 850, () => {
          cnt[l] += 1;
          $(`.lane[data-l="${l}"] .lcnt`, el).textContent = cnt[l];
          if (k % 2 === 0) Sound.tick();
        });
      });
      await wait(30 * 70 + 1000);
      $$('.lcnt', el).forEach((c) => anim(c, [{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { d: 500, e: SPRING }));
      Sound.ok();
      await wait(500);
    },
  });

  // 4 · Layer 1: Σ tasks × lane rate.
  scene({
    id: 'sum', title: 'Layer 1', noChrome: true, hold: 1400, dur: 7000,
    async run(el) {
      wipe();
      el.innerHTML = `${chap('04', 'layer 1 · task fee')}${['A', 'B', 'C'].map(laneHTML).join('')}
        ${SLOTS.map((s, k) => tile(s.x, s.y, `background:${LC[LANE_OF[k]]};border-color:${LC[LANE_OF[k]]}`)).join('')}`;
      ['A', 'B', 'C'].forEach((l) => { $(`.lane[data-l="${l}"] .lcnt`, el).textContent = COUNT[l]; });
      await wait(700);
      const tiles = $$('.tile', el);
      for (const l of ['A', 'B', 'C']) {
        const x = LANE_X[l];
        tiles.forEach((t, k) => {
          if (LANE_OF[k] !== l) return;
          const s = SLOTS[k];
          anim(t, [{ transform: 'none', opacity: 1 }, { transform: `translate(${x - 22 - s.x}px, ${640 - s.y}px) scale(.2)`, opacity: 0 }], { d: 450, delay: (k % 8) * 18, e: IN });
        });
        const coin = h(`<div class="coin" style="left:${x - 90}px;top:560px;--c:${LC[l]}"><b>${COUNT[l] * RATE[l]}k</b><span>${COUNT[l]} × ${RATE[l]}k</span></div>`);
        el.appendChild(coin);
        anim(coin, [{ transform: 'scale(0) rotate(-30deg)' }, { transform: 'none' }], { d: 650, delay: 380, e: SPRING });
        later(420, () => Sound.cash());
        await wait(650);
      }
      await wait(700);
      $$('.lane', el).forEach((ln, i) => anim(ln, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(60px)' }], { d: 450, delay: i * 60, e: IN }));
      $$('.coin', el).forEach((c, i) => {
        const x = LANE_X['ABC'[i]];
        anim(c, [{ transform: 'none', opacity: 1 }, { transform: `translate(${800 - x}px, ${-110}px) scale(.35)`, opacity: 0 }], { d: 600, delay: 250 + i * 90, e: IN });
      });
      await wait(950);
      const big = h(`<div class="bigcoin"><div class="sigma">Σ</div><small>CHF</small><b id="t">0</b><span>task fee</span></div>`);
      el.appendChild(big);
      anim(big, [{ transform: 'translate(-50%,-50%) scale(0)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { d: 800, e: SPRING });
      Sound.stamp();
      Sound.cash();
      await countUp($('#t', el), 85, { ms: 900, fmt: (v) => `${Math.round(v)}k` });
      await wait(700);
    },
  });

  // 5 · Layer 2: the bonus unlocks only when the goal is met.
  scene({
    id: 'bonus', title: 'Layer 2', noChrome: true, hold: 1800, dur: 10500,
    async run(el) {
      wipe();
      const R = 160;
      const L = 2 * Math.PI * R;
      el.innerHTML = `${chap('05', 'layer 2 · outcome bonus')}
        <div class="tot2"><small>CHF</small><b id="tot">85k</b></div>
        <div class="gold" id="gold"><span class="glock">${LOCK}</span><b>+20%</b></div>
        <div class="pillar"><b>85k</b><span>task fee</span></div>
        <div class="goal" style="left:${1110 - 200}px;top:${470 - 200}px">
          <svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="${R}" class="trk"/><circle cx="200" cy="200" r="${R}" class="arc" style="stroke-dasharray:${L};stroke-dashoffset:${L}"/></svg>
          <div class="gnum"><b id="files">12,000</b><span>open files</span></div>
          <svg class="gcheck" viewBox="0 0 100 100"><path pathLength="100" d="M24 52l17 17 36-38"/></svg>
        </div>
        <div class="gstamp">${I('target')} goal · 31.03</div>
        <div class="gchip invisible">${I('check')} 0 findings</div>`;
      anim($('.pillar', el), [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { d: 800, e: SPRING, delay: 200 });
      anim($('.tot2', el), [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { d: 500, delay: 600 });
      anim($('#gold', el), [{ opacity: 0, transform: 'translateY(-30px)' }, { opacity: 1, transform: 'none' }], { d: 600, delay: 800, e: SPRING });
      anim($('.goal', el), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { d: 700, delay: 500, e: SPRING });
      await wait(1500);
      anim($('.gstamp', el), [{ transform: 'scale(2.4) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1) rotate(-12deg)', opacity: 1 }], { d: 450, e: 'cubic-bezier(.3,1.6,.5,1)' });
      Sound.stamp();
      await wait(900);
      const arc = $('.goal .arc', el);
      tween(2200, (p) => { arc.style.strokeDashoffset = L * (1 - p); }, ease.inOut);
      for (let i = 0; i < 8; i++) later(i * 260, () => Sound.tick());
      await countUp($('#files', el), 0, { from: 12000, ms: 2200, fmt: num });
      const chip = $('.gchip', el);
      chip.classList.remove('invisible');
      anim(chip, [{ transform: 'translateY(20px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { d: 500, e: SPRING });
      Sound.ok();
      await wait(600);
      $('.goal', el).classList.add('met');
      Sound.dingding();
      await wait(600);
      $('#gold', el).classList.add('open');
      Sound.unlockS();
      await wait(500);
      $('#gold', el).classList.add('paid');
      anim($('#gold', el), [{ transform: 'none' }, { transform: 'translateY(58px)', offset: 0.7 }, { transform: 'translateY(48px)' }], { d: 650, e: 'cubic-bezier(.5,0,.5,1)' });
      later(450, () => { Sound.stamp(); Sound.win(); FX.celebrate(); });
      await wait(500);
      await countUp($('#tot', el), 102, { from: 85, ms: 900, fmt: (v) => `${Math.round(v)}k` });
      await wait(900);
    },
  });

  // 6 · Same formula, four businesses.
  scene({
    id: 'biz', title: 'Every business', noChrome: true, hold: 1600, dur: 7600,
    async run(el) {
      wipe();
      const B = [
        { n: 'Audit', mix: [21, 6, 3], bonus: false },
        { n: 'Financial<br>services', mix: [15, 10, 5], bonus: true },
        { n: 'Tax &amp;<br>legal', mix: [12, 11, 7], bonus: true },
        { n: 'Advisory', mix: [6, 9, 15], bonus: true },
      ];
      const fee = (m) => m[0] + m[1] * 3 + m[2] * 8;
      const base = 720;
      el.innerHTML = `${chap('06', 'same formula · every business')}
        ${B.map((b, i) => {
          const cx = 395 + i * 270;
          const f = fee(b.mix);
          const H = (f / 153) * 400;
          const cap = H * 0.2;
          return `
          <div class="tower" data-i="${i}" style="left:${cx - 90}px;top:${base - H}px;height:${H}px">
            ${b.mix.map((m, j) => `<i style="height:${((m * [1, 3, 8][j]) / f) * 100}%;background:${LC['ABC'[j]]}"></i>`).join('')}
          </div>
          <div class="${b.bonus ? 'tcap' : 'tcap lockd'}" data-i="${i}" style="left:${cx - 90}px;top:${base - H - cap - 6}px;height:${cap}px">${b.bonus ? '+' : LOCK}</div>
          <div class="tfee" data-i="${i}" style="left:${cx - 110}px;top:${base - H - cap - 70}px"><b>0</b>k</div>
          <div class="tname" style="left:${cx - 110}px;top:${base + 18}px">${b.n}</div>`;
        }).join('')}
        <div class="axis"><span>AI-led</span><i></i><span>human-led</span></div>`;
      $$('.tcap', el).forEach((c) => { c.style.opacity = 0; });
      for (let i = 0; i < B.length; i++) {
        anim($(`.tower[data-i="${i}"]`, el), [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { d: 900, e: SPRING });
        countUp($(`.tfee[data-i="${i}"] b`, el), fee(B[i].mix), { ms: 900, fmt: num });
        Sound.cash();
        await wait(220);
      }
      anim($('.axis', el), [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)' }], { d: 700 });
      await wait(1300);
      for (let i = 0; i < B.length; i++) {
        const c = $(`.tcap[data-i="${i}"]`, el);
        c.style.opacity = '';
        if (B[i].bonus) {
          anim(c, [{ transform: 'translateY(-260px)', opacity: 0 }, { transform: 'translateY(8px)', opacity: 1, offset: 0.75 }, { transform: 'none', opacity: 1 }], { d: 600, e: 'cubic-bezier(.5,0,.5,1)' });
          const f = fee(B[i].mix);
          later(450, () => { Sound.stamp(); countUp($(`.tfee[data-i="${i}"] b`, el), Math.round(f * 1.2), { from: f, ms: 500, fmt: num }); });
        } else {
          anim(c, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { d: 500, e: SPRING });
          later(200, () => Sound.seal());
        }
        await wait(260);
      }
      await wait(1200);
    },
  });

  // 7 · Win–win.
  scene({
    id: 'win', title: 'Win–win', noChrome: true, hold: 1600, dur: 6200,
    async run(el) {
      wipe();
      el.innerHTML = `${chap('07', 'win–win')}
        <div class="half l"><div class="hic">${I('user')}</div><div class="hbig"><b id="c">0</b>%</div><div class="hsub">client pays · 209k → 102k</div></div>
        <div class="divider"></div>
        <div class="half r"><div class="hic">${I('spark')}</div><div class="hbig"><b id="k">0</b>%</div><div class="hsub">KPMG earns · 57k → 102k</div></div>`;
      anim($('.divider', el), [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { d: 700, delay: 300 });
      anim($('.half.l', el), [{ opacity: 0, transform: 'translateY(60px)' }, { opacity: 1, transform: 'none' }], { d: 700, delay: 300, e: SPRING });
      anim($('.half.r', el), [{ opacity: 0, transform: 'translateY(60px)' }, { opacity: 1, transform: 'none' }], { d: 700, delay: 550, e: SPRING });
      await wait(700);
      countUp($('#c', el), -51, { ms: 1200, fmt: (v) => `−${Math.abs(Math.round(v))}` });
      await wait(450);
      Sound.ok();
      await countUp($('#k', el), 79, { ms: 1200, fmt: (v) => `+${Math.round(v)}` });
      Sound.dingding();
      await wait(1100);
    },
  });

  // 8 · End card.
  scene({
    id: 'end', title: 'Trust+', noChrome: true, hold: 0, dur: 6000,
    async run(el) {
      wipe();
      el.innerHTML = `
        <div class="endcard">
          <svg class="elogo" viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="#00338d" stroke-width="2.4" pathLength="1"/><path d="M9 17.5l4.2 4.2L23.5 11" fill="none" stroke="#0091da" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>
          <h1>${letters('Trust')}<span class="plus">+</span></h1>
          <div class="eform"><span class="ea">Σ tasks × lane rate</span><span class="eo">+</span><span class="eg">outcome bonus</span></div>
          <div class="etags"><span>transparent</span><span>fair</span><span>proven</span></div>
        </div>`;
      await wait(400);
      Sound.chord();
      await wait(2600);
    },
  });
  // ------------------------------------------------------------------ engine
  function cleanup() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.pending = null;
    S.done = false;
    nextHint.classList.remove('on');
    Cursor.hide();
    stage.querySelectorAll('.flash, .finale').forEach((n) => n.remove());
    const intro = document.getElementById('intro');
    if (intro && !intro.dataset.revealing) intro.remove();
  }

  function updateChrome(sc, i) {
    const side = document.getElementById('scene-side');
    const labels = { backend: 'Backend', frontend: i === 13 ? 'Client' : 'KPMG workspace', business: 'Business model' };
    side.className = `side ${sc.side}`;
    side.textContent = sc.side ? labels[sc.side] : '';
    document.getElementById('scene-num').textContent = i ? String(i).padStart(2, '0') : '';
    document.getElementById('scene-title').textContent = i ? sc.title : '';
    [...dotsEl.children].forEach((d, k) => {
      d.className = k === i ? 'on' : k < i ? 'done' : '';
    });
    stage.classList.toggle('chrome-off', !!sc.noChrome);
    document.querySelectorAll('#story i').forEach((d, k) => {
      d.className = '';
      void d.offsetWidth;
      d.style.setProperty('--dur', `${(sc.dur || 6000) / S.speed}ms`);
      d.className = k < i ? 'done' : k === i ? 'on' : '';
    });
    stage.classList.toggle('on-intro', i === 0);
  }

  async function go(i) {
    if (i < 0 || i >= SCENES.length) return;
    cleanup();
    S.i = i;
    const tok = ++S.token;
    const sc = SCENES[i];
    updateChrome(sc, i);
    if (sc.rail) {
      Rail.apply(sc.rail);
      stage.classList.add('rail-on');
    } else {
      stage.classList.remove('rail-on');
    }
    root.innerHTML = '';
    const el = document.createElement('section');
    el.className = `scene scene-${sc.id}`;
    root.appendChild(el);
    try {
      await sc.run(el);
    } catch (err) {
      console.error(err);
    }
    if (tok !== S.token) return;
    S.done = true;
    afterDone();
  }

  function afterDone() {
    if (!S.done || S.i >= SCENES.length - 1) return;
    if (S.mode === 'auto') later(SCENES[S.i].hold ?? 1500, () => go(S.i + 1));
    else nextHint.classList.add('on');
  }

  function next() {
    if (!S.started) return start();
    if (S.pending) { S.pending.fire(true); return; }
    if (S.i < SCENES.length - 1) go(S.i + 1);
  }
  function prev() {
    if (S.started && S.i > 0) go(S.i - 1);
  }
  function start(at) {
    if (S.started) return;
    S.started = true;
    Sound.unlock();
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 450);
    go(at ?? (Number(params.get('scene')) || 0));
  }
  function setMode(m) {
    S.mode = m;
    stage.classList.toggle('mode-auto', m === 'auto');
    stage.classList.toggle('mode-live', m === 'live');
    modeBtn.innerHTML = `<span class="led"></span>${m === 'auto' ? 'AUTO' : 'LIVE'}`;
    if (m === 'auto') {
      nextHint.classList.remove('on');
      if (S.pending) S.pending.fire(false);
      else afterDone();
    } else if (S.done) {
      S.timers.forEach(clearTimeout);
      S.timers = [];
      nextHint.classList.add('on');
    }
  }
  function setSound(on) {
    S.sound = on;
    soundBtn.innerHTML = I(on ? 'soundOn' : 'soundOff');
    if (on) Sound.unlock();
  }

  SCENES.forEach((sc, k) => {
    const b = document.createElement('button');
    b.title = sc.title;
    b.addEventListener('click', () => { if (S.started) go(k); else start(k); });
    dotsEl.appendChild(b);
  });
  splash.addEventListener('click', () => start());
  nextHint.addEventListener('click', next);
  modeBtn.addEventListener('click', () => setMode(S.mode === 'auto' ? 'live' : 'auto'));
  soundBtn.addEventListener('click', () => setSound(!S.sound));
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (k === ' ') { e.preventDefault(); if (!S.started) start(); else setMode(S.mode === 'auto' ? 'live' : 'auto'); }
    else if (['ArrowLeft', 'PageUp'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'a' || k === 'A') { if (!S.started) { setMode('auto'); start(); } else setMode('auto'); }
    else if (k === 'l' || k === 'L') setMode('live');
    else if (k === 'r' || k === 'R') { if (S.started) go(0); }
    else if (k === 's' || k === 'S') setSound(!S.sound);
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });

  setMode(S.mode);
  setSound(S.sound);
  Rail.build();
  if (params.has('autostart')) start();

  // Exposed for rehearsal and automated checks.
  window.trustplus = { go, next, prev, start, setMode, state: S, scenes: SCENES.map((s) => s.id) };
})();
