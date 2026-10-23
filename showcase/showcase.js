/* Countersign showcase: a scripted, presenter-driven product story.
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
    mode: params.has('auto') || params.get('mode') === 'auto' ? 'auto' : 'live',
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
    const colors = ['#a78bfa', '#c4b5fd', '#5b9dff', '#93c5fd', '#f6c96b', '#34d399', '#ffffff', '#f472b6'];
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

  // ------------------------------------------------------------------ data (Alpina / SinoGear fixture)
  const MS = [
    { k: 'M1', t: 'Key-term extraction', lane: 'AI leads · Lea spot-checks', who: 'Lea', w: 0.10, chf: 570, sum: '11 terms · 1 corrected by Lea' },
    { k: 'M2', t: 'Benchmark vs market', lane: 'AI drafts · Lea confirms', who: 'Lea', w: 0.15, chf: 855, sum: '4 deviations confirmed' },
    { k: 'M3', t: 'Risk screening', lane: 'Lea leads · blind first pass', who: 'Lea', w: 0.35, chf: 1995, sum: '4 risks · 1 trap caught' },
    { k: 'M4', t: 'Proposed redlines', lane: 'AI drafts · Lea edits', who: 'Lea', w: 0.25, chf: 1425, sum: '5 redlines · 1 rewritten' },
    { k: 'M5', t: 'Negotiation priorities', lane: 'Marco leads', who: 'Marco', w: 0.15, chf: 855, sum: '3 priorities ranked' },
  ];
  const TERMS = [
    ['Term', '3 years + 1-year renewals', 96],
    ['Unit price', 'USD 48.50, FCA Ningbo', 95],
    ['Price adjustment', 'Unknown: Annex C missing', 41, true],
    ['Delivery schedule', 'No lead time defined', 58, true],
    ['Warranty', '6 months from delivery', 94],
    ['Delay damages', '0.5% a week, cap 2%', 92],
    ['Liability cap', '10% of annual purchases', 90],
    ['Termination', 'Convenience: 180 days, after year 1', 91],
    ['Incoterms', 'FCA Ningbo (2020)', 93],
    ['Governing law', 'Swiss law · ICC Zurich', 97],
  ];
  const TAXONOMY = [
    ['105', 'Termination and exit rights'],
    ['208', 'Counterparty credit'],
    ['306', 'Acceptance and inspection'],
    ['401', 'Hold-up after redesign'],
    ['402', 'Ownership of tooling'],
    ['403', 'Price adjustment'],
  ];
  const AI_RISKS = [
    ['403', 'Price can rise at the supplier\'s discretion', 'Annex C · yearly reset, no index or cap', 90],
    ['306', 'No acceptance inspection', 'Clause 9 · defects may surface after warranty', 83],
    ['401', 'Hold-up after redesign', '6.4 / 11.2 · supplier owns tooling, no supply duty', 79],
    ['208', 'Warranty claims may be uncollectible', 'No parent guarantee or bond', 74],
    ['105', 'Supplier can exit on 30 days\' notice', 'Clause 14.2', 82],
  ];

  // ------------------------------------------------------------------ progress rail
  const Rail = {
    built: false,
    build() {
      railEl.classList.add('glass-rail');
      railEl.innerHTML = `
        <div class="rail-head">
          <div class="eyebrow">Engagement · Legal</div>
          <div class="rt">Alpina × SinoGear contract review</div>
          <div class="rail-bar"><i></i></div>
          <div class="rail-pct"><span>Progress</span><b>0%</b></div>
        </div>
        <div class="rail-list">
          ${MS.map((m) => `
            <div class="ri queued" data-k="${m.k}">
              <div class="st"></div>
              <div><div class="t"><span class="k">${m.k}</span>&nbsp; ${m.t}</div><div class="n"></div></div>
              <div class="v">${num(m.chf)}</div>
            </div>`).join('')}
        </div>
        <div class="rail-team"><div class="eyebrow">On this engagement</div><div class="people">
          <div class="p"><div class="av ink">LB</div>Lea Brunner<span>leads M1–M4</span></div>
          <div class="p"><div class="av ink">MR</div>Marco Rossi<span>M5 · signs</span></div>
          <div class="p"><div class="av ai">${I('spark')}</div>5 AI agents<span>draft · never sign</span></div>
        </div></div>
        <div class="rail-act"><div class="eyebrow">AI is working on</div><div class="line"></div></div>
        <div class="rail-earn"><span>Signed so far</span><b>CHF 0</b></div>`;
      this.built = true;
    },
    apply(cfg) {
      if (!this.built) this.build();
      for (const m of MS) {
        const [st, note] = cfg.items[m.k] || ['queued', ''];
        this.set(m.k, st, note, true);
      }
      this.pct(cfg.pct || 0);
      this.act(cfg.act || '');
      this.earned = cfg.earned || 0;
      railEl.querySelector('.rail-earn b').textContent = chf(this.earned);
    },
    set(k, st, note = '', quiet = false) {
      const it = railEl.querySelector(`.ri[data-k="${k}"]`);
      it.className = `ri ${st}`;
      it.querySelector('.n').textContent = note;
      if (!quiet && st === 'signed') {
        const m = MS.find((x) => x.k === k);
        this.addEarn(m.chf);
      }
    },
    pct(p) {
      railEl.querySelector('.rail-bar i').style.width = `${p}%`;
      railEl.querySelector('.rail-pct b').textContent = `${Math.round(p)}%`;
    },
    act(text) {
      const line = railEl.querySelector('.rail-act .line');
      line.textContent = text || 'Waiting for the next step';
    },
    addEarn(v) {
      const el = railEl.querySelector('.rail-earn b');
      const from = this.earned;
      this.earned += v;
      countUp(el, this.earned, { from, ms: 700 });
    },
  };

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
                <stop offset="0" stop-color="#ede9fe"/>
                <stop offset=".25" stop-color="#a78bfa"/>
                <stop offset=".6" stop-color="#6d28d9"/>
                <stop offset="1" stop-color="#2f6bff"/>
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

  // 1 · Backend: a swarm of agents takes in every inflow.
  scene({
    id: 'swarm', title: 'Agent swarm', side: 'backend', hold: 300,
    async run(el) {
      el.innerHTML = `
        <div class="swarm">
          <div>
            <div class="col-head"><span class="eyebrow">Inflows</span><span class="live-dot">Live</span></div>
            <div class="inflows"></div>
          </div>
          <div class="swarm-center">
            <div class="counters">
              <div class="counter card"><b data-c="docs">0</b><span>Documents in</span></div>
              <div class="counter card"><b data-c="pages">0</b><span>Pages read</span></div>
              <div class="counter card"><b data-c="clauses">0</b><span>Clauses parsed</span></div>
              <div class="counter card"><b data-c="secs">0s</b><span>Agent time</span></div>
            </div>
            <div class="swarm-canvas-wrap card"><canvas></canvas>
              <div class="swarm-cap">5 specialised agents · 1 synthesis · nothing reaches KPMG until it is structured</div>
            </div>
          </div>
          <div>
            <div class="col-head"><span class="eyebrow">Agent log</span><span class="tag ai">${I('spark')} swarm</span></div>
            <div class="card log"></div>
          </div>
        </div>`;
      const canvas = $('canvas', el);
      const sw = Swarm(canvas);
      loop((dt) => { sw.frame(dt); });

      const inflowsEl = $('.inflows', el);
      const logEl = $('.log', el);
      const c = (k) => $(`[data-c="${k}"]`, el);
      let docs = 0;
      let pages = 0;
      let elapsed = 0;
      loop((dt) => {
        elapsed += dt;
        c('secs').textContent = `${Math.min(41, Math.floor(elapsed * 3))}s`;
      });
      const clock = (s) => `09:14:${String(s).padStart(2, '0')}`;
      const log = (sec, agent, msg, cls = '') => {
        logEl.appendChild(h(`<div class="ln ${cls}"><span class="ts">${clock(sec)}</span><span><span class="ag">${agent}</span> ${msg}</span></div>`));
        Sound.tick();
      };
      const inflow = (d) => {
        const n = h(`
          <div class="inflow card ${d.hot ? 'hot' : ''}">
            <div class="ic">${I(d.ic)}</div>
            <div><div class="src">${d.src}</div><div class="what">${d.what}</div><div class="meta">${d.meta}</div></div>
          </div>`);
        inflowsEl.appendChild(n);
        Sound.blip(660 + docs * 80);
        later(250, () => {
          const r = n.getBoundingClientRect();
          const cr = canvas.getBoundingClientRect();
          const yy = (r.top + r.height / 2 - cr.top) / S.scale;
          sw.packet(Math.max(16, Math.min(sw.h - 16, yy)), d.ag);
        });
        docs += 1;
        c('docs').textContent = docs;
        countUp(c('pages'), pages + d.pages, { from: pages, ms: 800, fmt: num });
        pages += d.pages;
      };

      later(300, () => inflow({ ic: 'mail', src: 'Email · client', what: '“SinoGear draft v1, please review”', meta: 'legal@alpina-pumps.ch · 23 pages', ag: 0, pages: 23 }));
      later(1300, () => { log(3, 'Extractor', 'parsed 18 clauses, 11 key terms'); countUp(c('clauses'), 18, { ms: 900, fmt: num }); });
      later(1900, () => inflow({ ic: 'folder', src: 'Data room', what: 'Annex A · MH-200 drawings', meta: '41 files · 38 pages', ag: 1, pages: 38 }));
      later(2900, () => log(9, 'Benchmarker', 'matched against 1,240 supply agreements'));
      later(3400, () => inflow({ ic: 'db', src: 'ERP export', what: 'Purchase volumes 2023–25', meta: 'CHF 4.2m a year with SinoGear', ag: 2, pages: 6 }));
      later(4400, () => log(14, 'Risk Scout', 'exposure CHF 4.2m a year, multi-year'));
      later(4900, () => inflow({ ic: 'layers', src: 'Client portal', what: 'Pump redesign roadmap 2027', meta: 'Strategy deck · 18 pages', ag: 3, pages: 18 }));
      later(5900, () => log(19, 'Redliner', 'loaded Alpina playbook v4 + roadmap'));
      later(6700, () => log(23, 'Extractor', 'clause 5.3 points to Annex C: not attached', 'warn'));
      later(7500, () => log(24, 'Negotiator', 'requested Annex C from the client'));
      later(8400, () => inflow({ ic: 'mail', src: 'Email · on request', what: 'Annex C · price adjustment', meta: 'Arrived 4 minutes after the request', ag: 4, pages: 2, hot: true }));
      later(9400, () => log(31, 'Risk Scout', 'Annex C: supplier may reset prices at its discretion', 'warn'));
      later(10400, () => { log(33, 'Risk Scout', 'risk list sealed · sha256 3fa9c1…e07b', 'seal'); Sound.seal(); });
      later(11300, () => log(38, 'Redliner', '5 redlines drafted against the playbook'));
      later(12100, () => log(41, 'Synthesis', 'structured · sending to the KPMG workspace', 'ok'));
      await wait(12500);
      Sound.swell(1.5);
      await tween(1500, (p) => sw.setConverge(p), ease.in);
      flash();
      Sound.boom();
      await wait(350);
    },
  });

  function Swarm(canvas) {
    const wrap = canvas.parentElement;
    const w = wrap.offsetWidth;
    const hgt = wrap.offsetHeight;
    canvas.width = w * 2;
    canvas.height = hgt * 2;
    const c = canvas.getContext('2d');
    c.scale(2, 2);
    const cx = w / 2;
    const cy = hgt / 2 - 14;
    const agents = ['Extractor', 'Benchmarker', 'Risk Scout', 'Redliner', 'Negotiator'].map((n, i) => ({ n, a: -Math.PI / 2 + (i * 2 * Math.PI) / 5, x: cx, y: cy, pulse: 0 }));
    const parts = [];
    for (let i = 0; i < 180; i++) {
      parts.push({ ag: i % 5, a: Math.random() * 6.28, r: 18 + Math.random() * 50, sp: (0.5 + Math.random() * 1.5) * (Math.random() < 0.5 ? -1 : 1), s: 0.6 + Math.random() * 1.6, x: cx, y: cy, blue: Math.random() < 0.3 });
    }
    const packets = [];
    const flows = [];
    let rot = 0;
    let converge = 0;
    let corePulse = 0;
    let time = 0;
    function frame(dt) {
      time += dt;
      rot += dt * 0.07;
      c.clearRect(0, 0, w, hgt);
      for (const ag of agents) {
        const a = ag.a + rot;
        const x = cx + Math.cos(a) * w * 0.33;
        const y = cy + Math.sin(a) * hgt * 0.33;
        ag.x = x + (cx - x) * converge;
        ag.y = y + (cy - y) * converge;
      }
      corePulse *= 0.94;
      const coreR = 30 + Math.sin(time * 2.2) * 3 + corePulse * 14 + converge * 60;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.2);
      g.addColorStop(0, 'rgba(245,243,255,1)');
      g.addColorStop(0.16, 'rgba(196,181,253,.9)');
      g.addColorStop(0.45, 'rgba(109,40,217,.28)');
      g.addColorStop(1, 'rgba(109,40,217,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, coreR * 3.2, 0, 6.29);
      c.fill();
      c.lineWidth = 1;
      for (const ag of agents) {
        const lg = c.createLinearGradient(ag.x, ag.y, cx, cy);
        lg.addColorStop(0, 'rgba(167,139,250,.4)');
        lg.addColorStop(1, 'rgba(91,157,255,.05)');
        c.strokeStyle = lg;
        c.beginPath();
        c.moveTo(ag.x, ag.y);
        c.lineTo(cx, cy);
        c.stroke();
      }
      if (Math.random() < 0.55 && converge < 0.4) flows.push({ ag: (Math.random() * 5) | 0, t: 0 });
      for (let i = flows.length - 1; i >= 0; i--) {
        const f = flows[i];
        f.t += dt * 0.9;
        if (f.t >= 1) { flows.splice(i, 1); corePulse = Math.min(1, corePulse + 0.04); continue; }
        const ag = agents[f.ag];
        c.fillStyle = `rgba(221,214,254,${0.9 * (1 - f.t)})`;
        c.beginPath();
        c.arc(ag.x + (cx - ag.x) * f.t, ag.y + (cy - ag.y) * f.t, 1.8, 0, 6.29);
        c.fill();
      }
      const k = Math.min(1, dt * 6);
      for (const p of parts) {
        const ag = agents[p.ag];
        p.a += p.sp * dt;
        const tx = ag.x + Math.cos(p.a) * p.r * (1 - converge);
        const ty = ag.y + Math.sin(p.a) * p.r * 0.8 * (1 - converge);
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        c.fillStyle = p.blue ? 'rgba(147,197,253,.85)' : 'rgba(196,181,253,.85)';
        c.beginPath();
        c.arc(p.x, p.y, p.s, 0, 6.29);
        c.fill();
      }
      c.textAlign = 'center';
      for (const ag of agents) {
        ag.pulse *= 0.93;
        const r = 18 + ag.pulse * 9;
        const gg = c.createRadialGradient(ag.x, ag.y, 0, ag.x, ag.y, r * 2.6);
        gg.addColorStop(0, `rgba(167,139,250,${0.5 + ag.pulse * 0.4})`);
        gg.addColorStop(1, 'rgba(167,139,250,0)');
        c.fillStyle = gg;
        c.beginPath();
        c.arc(ag.x, ag.y, r * 2.6, 0, 6.29);
        c.fill();
        c.fillStyle = '#140d2e';
        c.strokeStyle = 'rgba(221,214,254,.95)';
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(ag.x, ag.y, r, 0, 6.29);
        c.fill();
        c.stroke();
        c.fillStyle = '#c4b5fd';
        c.font = '700 11px ui-monospace, Menlo, monospace';
        c.fillText('AI', ag.x, ag.y + 4);
        if (converge < 0.6) {
          c.globalAlpha = 1 - converge / 0.6;
          c.fillStyle = '#ede9fe';
          c.font = '600 12.5px Inter, system-ui, sans-serif';
          c.fillText(ag.n, ag.x, ag.y + r + 20);
          c.globalAlpha = 1;
        }
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i];
        pk.t += dt * 0.95;
        if (pk.t < 0) continue;
        const ag = agents[pk.ag];
        if (pk.t >= 1) { ag.pulse = 1; packets.splice(i, 1); continue; }
        const t = pk.t;
        const mx = w * 0.22;
        const my = (pk.fy + ag.y) / 2 - 50;
        const x = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * mx + t * t * ag.x;
        const y = (1 - t) * (1 - t) * pk.fy + 2 * (1 - t) * t * my + t * t * ag.y;
        c.shadowColor = '#93c5fd';
        c.shadowBlur = 14;
        c.fillStyle = 'rgba(255,255,255,.95)';
        c.beginPath();
        c.arc(x, y, 2.7, 0, 6.29);
        c.fill();
        c.shadowBlur = 0;
      }
      c.fillStyle = '#2e1065';
      c.font = '800 10.5px Inter, system-ui, sans-serif';
      c.fillText('SYNTHESIS', cx, cy + 4);
    }
    return {
      frame,
      h: hgt,
      packet(fy, ag) { for (let k = 0; k < 8; k++) packets.push({ t: -k * 0.05, fy: fy + (Math.random() - 0.5) * 18, ag }); },
      setConverge(v) { converge = v; },
    };
  }

  // 2 · The backend hands a structured contract to the frontend.
  scene({
    id: 'contract', title: 'Contract received', side: 'frontend', hold: 7000,
    async run(el) {
      el.innerHTML = `
        <div class="contract">
          <div class="card contract-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div class="new-badge">NEW CONTRACT RECEIVED</div>
                <h1 class="h1" style="margin-top:12px">Supply Agreement</h1>
                <div class="muted" style="margin-top:6px;font-size:15px">SinoGear draft v1 · custom motor housings, series MH-200</div>
              </div>
              <span class="tag ai">${I('spark')} Structured by AI in 41s</span>
            </div>
            <div class="parties">
              <div class="party"><span class="cc">CH</span><b>Alpina Pumps AG</b><span class="dim">Buyer · KPMG client</span></div>
              <span class="x">⇄</span>
              <div class="party"><span class="cc">CN</span><b>SinoGear Ltd</b><span class="dim">Supplier</span></div>
            </div>
            <div class="meta-row"><span>Received <b>09:14</b></span><span><b>23</b> pages</span><span><b>18</b> clauses</span><span>Value <b>CHF 4.2m a year</b></span><span>Swiss law · <b>ICC Zurich</b></span></div>
            <div class="terms"></div>
          </div>
          <div class="synth">
            <div class="card synth-card">
              <div class="synth-head"><div class="av ai">${I('spark')}</div><div><div class="eyebrow">AI synthesis</div><div class="h3">What the swarm found</div></div></div>
              <div class="stats">
                <div class="stat"><b data-n="4">0</b><span>deviations from market</span></div>
                <div class="stat"><b data-n="4">0</b><span>risks to screen</span></div>
                <div class="stat"><b data-n="5">0</b><span>redlines drafted</span></div>
                <div class="stat"><b data-n="2">0</b><span>terms need a human eye</span></div>
              </div>
              <div class="summary ai-text"></div>
            </div>
            <div class="card send"><span class="eyebrow" style="color:var(--ai)">Backend</span><div class="arrow"></div><span class="eyebrow" style="color:var(--ink)">KPMG reviewer</span></div>
          </div>
        </div>`;
      Sound.whoosh();
      await wait(700);
      const terms = $('.terms', el);
      for (const [l, v, pc, flag] of TERMS) {
        const n = h(`<div class="term pop ${flag ? 'flag' : ''}"><div class="l">${l}</div><div class="v">${v}</div>
          <div class="conf ${pc < 70 ? 'low' : ''}"><div class="bar"><i></i></div><span class="pc">${pc}%</span></div></div>`);
        terms.appendChild(n);
        requestAnimationFrame(() => { n.querySelector('.bar i').style.width = `${pc}%`; });
        Sound.tick();
        await wait(110);
      }
      await wait(200);
      $$('.stat b', el).forEach((b) => countUp(b, Number(b.dataset.n), { ms: 800, fmt: num }));
      Sound.blip(990);
      await wait(700);
      await typeText($('.summary', el), 'Supplier-friendly draft. SinoGear can reset prices at its discretion, there is no acceptance inspection, and the liability cap sits far below market.', { cps: 75, sound: false });
    },
  });

  // 3 · The platform recommends the price; a named manager confirms it.
  scene({
    id: 'price', title: 'Price locked', side: 'frontend', hold: 6500,
    async run(el) {
      el.innerHTML = `
        <div class="price">
          <div class="card lead">
            <div class="eyebrow">Pricing · recommended by the platform, confirmed by a person</div>
            <div class="tier"><b class="grad">Tier 2</b><span class="h3 muted">complexity &nbsp;·&nbsp; internal use</span></div>
            <div class="reasons"></div>
            <div class="fair invisible">${I('shield')}<div><b>Client importance never raises the price.</b><br><span class="muted">Alpina is a key client, so review is stricter, at KPMG's cost. Quality &amp; Risk sees every override.</span></div></div>
          </div>
          <div class="card quote">
            <div class="eyebrow">Quote · contract review</div>
            <div class="qline"><div class="n">Judgment</div><div class="d">What people review, challenge and decide · Tier 2 · AI work included</div><div class="p">${chf(5700)}</div></div>
            <div class="qline"><div class="n">Signature</div><div class="d">A named person signs · KPMG carries the liability · internal use</div><div class="p">${chf(1500)}</div></div>
            <div class="qtotal"><span class="muted">Total</span><b>${chf(7200)}</b></div>
            <div class="confirm-row">
              <div class="av ink">MR</div>
              <div class="who"><b>Marco Rossi</b><span>Manager, Legal · must confirm or override</span></div>
              <button class="btn ink" id="confirm">${I('lockS')} Confirm &amp; lock</button>
            </div>
            <div class="lock-slot"></div>
          </div>
        </div>`;
      const reasons = $('.reasons', el);
      const R = ['Contract value above CHF 1m a year', 'Multi-year term: 3 years + renewals', 'Cross-border: Switzerland ⇄ China', 'Bespoke, supplier-drafted terms'];
      await wait(500);
      for (const r of R) {
        reasons.appendChild(h(`<div class="reason pop">${I('check')}<span>${r}</span><span class="by ai" style="margin-left:auto">AI</span></div>`));
        Sound.tick();
        await wait(260);
      }
      $('.fair', el).classList.remove('invisible');
      $('.fair', el).classList.add('pop');
      await wait(500);
      await act('#confirm', 'Marco');
      Sound.stamp();
      $('#confirm', el).replaceWith(h(`<span class="tag ink pop">${I('lockS')} Locked</span>`));
      $('.quote', el).classList.add('locked');
      $('.lock-slot', el).appendChild(h(`<div class="lockline pop">${I('lockS')}<div><b>Locked by Marco Rossi · 09:16</b><div class="hash">ledger #0004 · price list 2026.10 · 5b7c…8d9a</div></div></div>`));
      Sound.ok();
    },
  });

  // 4 · Handoff: the AI has split the work; Lea can still shape it.
  scene({
    id: 'handoff', title: 'Handoff to Lea', side: 'frontend', hold: 5500,
    rail: { pct: 4, act: 'Pre-filling 11 key terms for M1', items: { M1: ['ai', 'AI pre-filling'], M2: ['ai', 'AI benchmarking'], M3: ['queued', 'Sealed AI list ready'], M4: ['ai', 'AI drafting'], M5: ['queued', ''] } },
    async run(el) {
      el.innerHTML = `
        <div class="handoff">
          <div class="card person">
            <div class="top"><div class="av ink lg">LB</div><div><div class="nm">Lea Brunner</div><div class="rl">Junior Associate · Legal</div></div></div>
            <div class="facts">
              <div><span>Certification</span><b class="ink-text">AI-review ✓</b></div>
              <div><span>Planted checks caught</span><b>7 of 7</b></div>
              <div><span>Decisions with a reason</span><b>100%</b></div>
            </div>
            <div class="assigned pop">${I('user')}<div><b>Assigned by Marco Rossi</b><br><span class="muted">Only certified staff lead AI-assisted work</span></div></div>
          </div>
          <div class="card plan">
            <div class="plan-head">
              <div><div class="eyebrow">Deliverable</div><h2 class="h2" style="margin-top:6px">Contract review report</h2><div class="muted" style="margin-top:6px;font-size:13.5px">Split into 5 milestones by the AI. Lea can reorder, reassign, add or remove.</div></div>
              <span class="tag ai">${I('spark')} Planned by AI</span>
            </div>
            <div class="plan-list"></div>
            <div class="add-row"><button class="btn ghost" id="add">${I('plus')} Add a check</button><span class="muted" style="font-size:12.5px">Lea's own additions are written in ink blue</span></div>
            <div class="add-slot"></div>
          </div>
        </div>`;
      Sound.whoosh();
      const list = $('.plan-list', el);
      await wait(500);
      for (const m of MS) {
        list.appendChild(h(`
          <div class="pm" data-k="${m.k}">
            <span class="grip">${I('grip')}</span>
            <span class="k">${m.k}</span>
            <div><div class="t">${m.t}</div><div class="sub">${m.lane}</div><div class="checks"></div></div>
            <span class="tag ink">${m.who}</span>
            <span class="w">${Math.round(m.w * 100)}%</span>
          </div>`));
        Sound.tick();
        await wait(170);
      }
      await wait(400);
      await act('#add');
      $('.add-row', el).replaceWith(h(`<div class="add-row pop"><div class="add-input"><span class="typed"></span><span class="caret"></span></div><span class="tag plain">to M3 · Risk screening</span><button class="btn ink" id="addgo">Add</button></div>`));
      await typeText($('.typed', el), 'Enforceability of an ICC award against SinoGear in China', { cps: 55 });
      await act('#addgo');
      const m3 = $('.pm[data-k="M3"]', el);
      m3.classList.add('hl');
      m3.querySelector('.checks').appendChild(h(`<span class="tag ink pop">${I('pen')} China enforceability · added by Lea</span>`));
      $('.add-row', el).remove();
      Sound.ok();
      await wait(350);
      $('.add-slot', el).appendChild(h(`<div class="ai-reply pop"><div class="av ai">${I('spark')}</div><div class="ai-text">Added to M3 · Risk screening. It stays inside the confirmed Tier 2 scope, so <b>the price does not change</b>.</div></div>`));
      Rail.set('M3', 'queued', '+1 check from Lea');
    },
  });

  // 5 · Lea works M1 and M2 alongside the AI.
  scene({
    id: 'work', title: 'Lea at work', side: 'frontend', hold: 6500,
    rail: { pct: 12, act: 'Benchmarking clause 8.2 against 1,240 agreements', items: { M1: ['human', 'With Lea · spot-check'], M2: ['ai', 'AI benchmarking'], M3: ['queued', 'AI list sealed'], M4: ['ai', 'AI drafting 5 redlines'], M5: ['queued', ''] } },
    async run(el) {
      const rows = [TERMS[0], TERMS[1], TERMS[2], TERMS[3], TERMS[4], TERMS[6], TERMS[7]];
      el.innerHTML = `
        <div class="work">
          <div class="card panel" id="m1">
            <div class="panel-head"><div><div class="eyebrow">M1 · AI leads, Lea spot-checks</div><div class="h3">Key-term extraction</div></div><span class="tag ai">${I('spark')} 11 terms pre-filled</span></div>
            <div class="rows">
              ${rows.map(([l, v, pc, flag]) => `
                <div class="row ${flag ? 'flag' : ''}" data-l="${l}">
                  <div><div class="l">${l}</div><div class="v">${v}</div></div>
                  <div class="conf ${pc < 70 ? 'low' : ''}"><div class="bar"><i style="width:${pc}%"></i></div><span class="pc">${pc}%</span></div>
                  <div class="cell">${flag ? '<button class="btn sm ghost chk">' + I('search') + ' Check</button>' : '<div class="okmark"></div>'}</div>
                </div>`).join('')}
            </div>
            <div class="src-slot"></div>
          </div>
          <div class="card panel" id="m2" style="opacity:.35;transition:opacity .6s">
            <div class="panel-head"><div><div class="eyebrow">M2 · AI drafts, Lea confirms</div><div class="h3">Benchmark against market terms</div></div><span class="tag ai">${I('spark')} 1,240 agreements</span></div>
            <div class="rows devs"></div>
            <div class="foot-note">${I('pen')} No bulk approve. Every decision carries a name and a time.</div>
          </div>
        </div>`;
      // the confident rows get Lea's spot-check ticks right away
      await wait(500);
      for (const ok of $$('#m1 .okmark', el)) { ok.classList.add('on'); Sound.tick(); await wait(90); }
      await wait(250);
      const priceRow = $('.row[data-l="Price adjustment"]', el);
      await act(priceRow.querySelector('.chk'));
      $('.src-slot', el).appendChild(h(`
        <div class="source">
          <div class="src-h"><span class="eyebrow">Source · clause 5.3 + Annex C</span><span class="tag ink">Lea is reading</span></div>
          <div>“Prices shall be adjusted annually in accordance with Annex C.”</div>
          <div style="margin-top:6px" class="muted">Annex C (received on request): “Supplier may reset unit prices once per contract year <mark>at its discretion</mark>, with 30 days' notice.”</div>
        </div>`));
      Sound.blip(700);
      await wait(1700);
      priceRow.classList.remove('flag');
      priceRow.classList.add('fixed');
      priceRow.querySelector('.v').innerHTML = `<span class="strike">Unknown</span>Supplier resets once a year, at its discretion`;
      priceRow.querySelector('.cell').innerHTML = '<span class="by ink">Corrected by Lea</span>';
      Sound.ok();
      await wait(600);
      const delRow = $('.row[data-l="Delivery schedule"]', el);
      delRow.classList.remove('flag');
      delRow.classList.add('fixed');
      delRow.querySelector('.cell').innerHTML = '<span class="by ink">Confirmed by Lea</span>';
      Sound.tick();
      await wait(400);
      $('.src-slot', el).innerHTML = `<div class="ready-banner">${I('check')} M1 ready to sign · 1 term corrected by Lea</div>`;
      Rail.set('M1', 'ready', 'Ready to sign');
      Rail.set('M2', 'human', 'With Lea · confirming');
      Rail.pct(22);
      Rail.act('Drafting redlines for clauses 5.3, 8.2 and 9');
      $('#m2', el).style.opacity = 1;
      const devs = $('.devs', el);
      const D = [
        ['Warranty below market', '6 months vs 12–24 months', 0.2, [0.4, 0.8], '6 mo', '12–24'],
        ['Delay-damages cap below market', '2% vs 5–10%', 0.17, [0.42, 0.83], '2%', '5–10%'],
        ['Liability cap below market', '10% vs ~100% of annual value', 0.08, [0.72, 0.92], '10%', '~100%'],
        ['Discretionary price changes', 'Supplier discretion vs index-linked, capped', 0.95, [0.1, 0.45], 'discretion', 'index ±3–8%'],
      ];
      for (const [t, s, you, [a, b], ly, lm] of D) {
        devs.appendChild(h(`
          <div class="dev">
            <div><div class="t">${t}</div><div class="s">${s}</div></div>
            <div class="range"><div class="track"></div><div class="mkt" style="left:${a * 100}%;width:${(b - a) * 100}%"></div><div class="you" style="left:${you * 100}%"></div>
              <span class="lbl" style="left:${you * 100}%;transform:translateX(-50%);top:20px;color:var(--warn)">${ly}</span>
              <span class="lbl" style="left:${((a + b) / 2) * 100}%;transform:translateX(-50%);top:-6px;color:var(--ok)">${lm}</span></div>
            <div class="okmark"></div>
          </div>`));
        Sound.tick();
        await wait(220);
      }
      await wait(300);
      for (const ok of $$('.devs .okmark', el)) { ok.classList.add('on'); Sound.blip(1100); await wait(330); }
      devs.appendChild(h(`<div class="ready-banner">${I('check')} M2 ready to sign · 4 deviations confirmed by Lea</div>`));
      Rail.set('M2', 'ready', 'Ready to sign');
      Rail.set('M3', 'human', 'Blind first pass');
      Rail.pct(36);
    },
  });

  // 6 · The blind first pass: the AI's list stays sealed until Lea commits her own view.
  scene({
    id: 'blind', title: 'Blind first pass', side: 'frontend', hold: 9000,
    rail: { pct: 36, act: 'Holding the M3 list sealed · sha256 3fa9c1…e07b', items: { M1: ['ready', 'Ready to sign'], M2: ['ready', 'Ready to sign'], M3: ['human', 'Blind first pass'], M4: ['ai', 'AI drafting 5 redlines'], M5: ['queued', ''] } },
    async run(el) {
      el.innerHTML = `
        <div class="blind">
          <div class="card panel">
            <div class="panel-head"><div><div class="eyebrow">M3 · the AI's risk list</div><div class="h3">Sealed until Lea answers</div></div><span class="tag ai">${I('spark')} 5 findings</span></div>
            <div class="sealed-list sealed">
              ${AI_RISKS.map(([code, t, s, pc]) => `
                <div class="risk" data-code="${code}">
                  <span class="code">${code}</span>
                  <div><div class="t">${t}</div><div class="s">${s}</div></div>
                  <div class="conf"><div class="bar"><i style="width:${pc}%"></i></div><span class="pc">${pc}%</span></div>
                </div>`).join('')}
              <div class="seal-overlay"><div class="seal-box">${LOCK}<div class="t">Sealed</div><div class="s">Lea can't see the AI's answer until she submits her own</div><div class="hash">sha256 3fa9c1d7…e07b · committed 09:31</div></div></div>
            </div>
            <div class="verify-slot"></div>
          </div>
          <div class="card panel" id="lea">
            <div class="panel-head"><div><div class="eyebrow ink-text">M3 · Lea's blind first pass</div><div class="h3">Which risks does this contract carry?</div></div><span class="tag ink">${I('pen')} Lea</span></div>
            <div class="muted" style="font-size:13px;margin-bottom:10px">Pick from the firm's risk taxonomy. Her answer is fingerprinted the moment she submits.</div>
            <div class="chips">${TAXONOMY.map(([c, t]) => `<button class="chip" data-code="${c}"><span class="code">${c}</span>${t}</button>`).join('')}</div>
            <div class="submit-row"><span class="muted sel-count" style="font-size:12.5px">0 selected</span><button class="btn ink" id="submit">${I('check')} Submit &amp; unseal</button></div>
            <div class="diff-slot"></div>
          </div>
        </div>`;
      await wait(900);
      let n = 0;
      for (const code of ['403', '306']) {
        const chip = $(`.chip[data-code="${code}"]`, el);
        await act(chip);
        chip.classList.add('on');
        n += 1;
        $('.sel-count', el).textContent = `${n} selected`;
        Sound.blip(780 + n * 120);
        await wait(250);
      }
      await act('#submit');
      $$('.chip', el).forEach((c) => c.classList.add('lockd'));
      $('.submit-row', el).innerHTML = `<span class="tag ink pop">${I('lockS')} Committed 09:38 · sha256 81bd…44a0</span><span class="muted" style="font-size:12.5px">Lea can no longer change it</span>`;
      Sound.stamp();
      await wait(500);
      const overlay = $('.seal-overlay', el);
      overlay.classList.add('unsealing');
      Sound.unlockS();
      await wait(700);
      overlay.style.opacity = 0;
      $('.sealed-list', el).classList.remove('sealed');
      await wait(700);
      overlay.remove();
      $('.verify-slot', el).appendChild(h(`<div class="verify">${I('shield')} Fingerprint matches 09:31 · the AI's list was not changed after Lea answered</div>`));
      Sound.ok();
      await wait(700);
      ['403', '306'].forEach((c) => { const r = $(`.risk[data-code="${c}"]`, el); r.style.borderColor = 'rgba(52,211,153,.5)'; r.style.background = 'rgba(52,211,153,.07)'; });
      $('.diff-slot', el).appendChild(h(`
        <div class="diff">
          <div class="dcol both"><div class="eyebrow">Both found</div><div class="it"><span class="code">403</span>Price adjustment</div><div class="it"><span class="code">306</span>Acceptance &amp; inspection</div></div>
          <div class="dcol lea"><div class="eyebrow">Only Lea</div><div class="it muted">None this time</div></div>
          <div class="dcol ai"><div class="eyebrow">Only the AI</div><div class="it"><span class="code">401</span>Hold-up</div><div class="it"><span class="code">208</span>Counterparty credit</div><div class="it"><span class="code">105</span>Exit on 30 days</div></div>
        </div>`));
      Sound.tick();
      await wait(600);
      $('.diff-slot', el).appendChild(h(`<div class="learn">${I('book')} The gap goes into Lea's learning record. Now she checks every AI-only finding against the source.</div>`));
      Rail.act('Unsealed · 3 AI-only findings to review');
    },
  });

  // 7 · The planted trap: a plausible, false AI finding that a real review catches.
  scene({
    id: 'trap', title: 'Planted check', side: 'frontend', hold: 5500,
    rail: { pct: 44, act: 'Waiting for Lea on 3 AI-only findings', items: { M1: ['ready', 'Ready to sign'], M2: ['ready', 'Ready to sign'], M3: ['human', 'Reviewing AI-only findings'], M4: ['ai', 'AI drafting 5 redlines'], M5: ['queued', ''] } },
    async run(el) {
      el.innerHTML = `
        <div class="trap">
          <div class="card finding">
            <div style="display:flex;justify-content:space-between"><span class="eyebrow">AI-only finding · 3 of 3</span><span class="tag ai">${I('spark')} AI · 82% confident</span></div>
            <div class="big ai-text">Supplier can exit on 30 days' notice</div>
            <div class="det">The supplier may terminate for convenience on 30 days' notice, leaving Alpina without housings mid-redesign. <span class="ai-text">Cites clause 14.2.</span></div>
            <div class="acts">
              <button class="btn okb">${I('check')} Approve</button>
              <button class="btn danger" id="reject">${I('x')} Reject</button>
              <button class="btn ghost" id="src">${I('search')} Check source</button>
            </div>
            <div class="reason-slot"></div>
            <div class="after-trap"></div>
          </div>
          <div class="card clause">
            <div class="eyebrow">Contract source</div>
            <div class="clause-body muted" style="margin-top:14px;font-size:14px">The clause the AI cites opens here.</div>
          </div>
        </div>`;
      await wait(800);
      await act('#src');
      $('.clause', el).innerHTML = `
        <div class="eyebrow">Contract · clause 14.2</div>
        <div class="h3" style="margin-top:6px">Termination for convenience</div>
        <div class="ctext pop">After the first contract year, either party may terminate for convenience on <mark>one hundred and eighty (180) days'</mark> written notice.</div>
        <div class="vs pop"><div class="side ai"><span class="eyebrow">AI says</span><b>30 days</b></div><div class="ne">≠</div><div class="side src"><span class="eyebrow">Contract says</span><b>180 days</b></div></div>`;
      Sound.blip(600);
      later(300, () => $('.clause mark', el)?.classList.add('on'));
      await wait(1500);
      await act('#reject');
      $('.reason-slot', el).appendChild(h(`<div class="reasons-pick"><span class="muted" style="font-size:12.5px;align-self:center">Reason (required):</span><button class="btn sm ghost" id="nis">Not in the source</button><button class="btn sm ghost">Wrong clause</button><button class="btn sm ghost">Not material</button></div>`));
      await wait(300);
      await act('#nis');
      $('.reason-slot', el).innerHTML = `<div class="reasons-pick"><span class="tag ink">${I('x')} Rejected by Lea · not in the source · 09:41</span></div>`;
      $('.acts', el).style.opacity = 0.35;
      Sound.alert();
      await wait(350);
      const grid = $('.trap', el);
      grid.classList.add('dimmed');
      el.appendChild(h(`
        <div class="caught">
          <svg class="tgt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${P.target}</svg>
          <div class="ttl grad">PLANTED CHECK CAUGHT</div>
          <div class="txt">Quality &amp; Risk planted this false finding to test the review.<br>Approving it would have <b style="color:#fff">blocked the signature</b> and escalated to Marco.</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:16px"><span class="tag ink">Logged to Lea's record</span><span class="tag ok">Signature unblocked</span></div>
        </div>`));
      Sound.dingding(0.05);
      FX.small(800, 330);
      await wait(2700);
      $('.caught', el).animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(.9)' }], { duration: 350, fill: 'forwards' });
      grid.classList.remove('dimmed');
      await wait(350);
      $('.caught', el)?.remove();
      const after = $('.after-trap', el);
      for (const [code, t] of [['401', 'Hold-up after redesign'], ['208', 'Warranty claims may be uncollectible']]) {
        after.appendChild(h(`<div class="mini"><span class="code">${code}</span><span>${t}</span><span class="by ink">Approved by Lea</span></div>`));
        Sound.tick();
        await wait(350);
      }
      after.appendChild(h(`<div class="ready-banner">${I('check')} M3 ready to sign · 4 real risks approved, 1 trap rejected</div>`));
      Rail.set('M3', 'ready', 'Ready to sign · trap caught');
      Rail.pct(56);
    },
  });

  // 8 · Bespoke: Lea rewrites the AI's redline in her own words; Marco orders the priorities.
  scene({
    id: 'bespoke', title: 'Bespoke edits', side: 'frontend', hold: 6000,
    rail: { pct: 56, act: 'Redlines drafted · waiting for Lea', items: { M1: ['ready', 'Ready to sign'], M2: ['ready', 'Ready to sign'], M3: ['ready', 'Ready to sign · trap caught'], M4: ['human', 'With Lea · editing'], M5: ['queued', 'Marco next'] } },
    async run(el) {
      el.innerHTML = `
        <div class="bespoke">
          <div class="card redline">
            <div class="panel-head"><div><div class="eyebrow">M4 · AI drafts, Lea edits</div><div class="h3">Redline · clause 5.3 price adjustment</div></div><button class="btn sm ghost" id="edit">${I('pen')} Edit</button></div>
            <div class="orig">Prices shall be adjusted annually in accordance with Annex C.</div>
            <div class="prop">The unit price is adjusted once per contract year by the change in the Swiss producer price index (PPI) over the preceding twelve months, <span class="cap ai-text">capped at +/-5%.</span></div>
            <div class="authored"><span class="by ai">Drafted by AI</span></div>
            <div class="why-slot"></div>
            <div class="others"></div>
          </div>
          <div class="card panel" id="m5" style="opacity:.35;transition:opacity .6s">
            <div class="panel-head"><div><div class="eyebrow">M5 · led by Marco</div><div class="h3">Negotiation priorities</div></div><div class="av ink">MR</div></div>
            <div class="muted" style="font-size:13px">The AI brings the benchmark ranges. The order is a judgment call, so a person makes it.</div>
            <div class="prios" style="display:flex;flex-direction:column;gap:8px;margin-top:14px"></div>
          </div>
        </div>`;
      await wait(800);
      await act('#edit');
      $('#edit', el).outerHTML = `<span class="tag ink pop">${I('pen')} Lea is editing</span>`;
      const cap = $('.cap', el);
      cap.outerHTML = '<del>capped at +/-5%.</del> <ins class="typed"></ins>';
      Sound.blip(700);
      await typeText($('ins.typed', el), 'capped at +/-3%. If the cap is reached two years running, Buyer may terminate on 90 days\' notice.', { cps: 60 });
      $('.authored', el).appendChild(h(`<span class="by ink pop">Edited by Lea · reason recorded</span>`));
      $('.why-slot', el).appendChild(h(`<div class="why"><div class="eyebrow">Lea's reason</div><span class="typed2"></span></div>`));
      await typeText($('.typed2', el), 'Alpina needs stable prices. The benchmark shows caps of ±3–8%, so we open at the low end and add an exit.', { cps: 85, sound: false });
      Sound.ok();
      const others = $('.others', el);
      for (const t of ['Acceptance inspection: 30-day window', 'Delay damages: 1% a week, cap 10%', 'Minimum supply + tooling title to Alpina', 'Parent guarantee or performance bond']) {
        others.appendChild(h(`<div class="mini" style="grid-template-columns:1fr auto"><span>${t}</span><span class="by ink">Accepted by Lea</span></div>`));
        Sound.tick();
        await wait(230);
      }
      Rail.set('M4', 'ready', 'Ready to sign · 1 rewritten');
      Rail.set('M5', 'human', 'With Marco');
      Rail.pct(70);
      Rail.act('Benchmark ranges for the priorities');
      $('#m5', el).style.opacity = 1;
      const prios = $('.prios', el);
      for (const [i, t, s] of [[1, 'Price escalator cap', 'Index-linked, ±3%, with an exit'], [2, 'Tooling ownership & minimum supply', 'No hold-up after the redesign'], [3, 'Acceptance inspection', '30-day window, replaced at SinoGear\'s cost']]) {
        prios.appendChild(h(`<div class="prio"><div class="n">${i}</div><div><div class="t">${t}</div><div class="s">${s}</div></div></div>`));
        Sound.blip(800 + i * 120);
        await wait(380);
      }
      prios.appendChild(h(`<div class="ready-banner">${I('check')} M5 ready to sign · ordered by Marco Rossi</div>`));
      Rail.set('M5', 'ready', 'Ready to sign');
      Rail.pct(80);
      Rail.act('All milestones ready · waiting for signatures');
    },
  });

  // 9 · Every milestone is signed, and each signature earns its price.
  scene({
    id: 'signs', title: 'Milestones signed', side: 'frontend', hold: 5000,
    rail: { pct: 80, act: 'All milestones ready · waiting for signatures', items: { M1: ['ready', 'Ready to sign'], M2: ['ready', 'Ready to sign'], M3: ['ready', 'Ready to sign'], M4: ['ready', 'Ready to sign'], M5: ['ready', 'Ready to sign'] } },
    async run(el) {
      const shades = ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c6cf0', '#6d7cf6'];
      el.innerHTML = `
        <div class="signs">
          <div><div class="eyebrow">Sign-off</div><h2 class="h2" style="margin-top:6px">Each milestone is signed by the person who led it, and earns its price</h2></div>
          <div class="sign-grid">
            ${MS.map((m, i) => `
              <div class="card sc" data-k="${m.k}" style="animation-delay:${i * 90}ms">
                <div class="k">${m.k}</div>
                <div class="t">${m.t}</div>
                <div class="ln">${m.lane}</div>
                <div class="sum">${m.sum}</div>
                <div class="money"><small>CHF</small><span class="amt">—</span></div>
                <div class="share">${Math.round(m.w * 100)}% of Judgment</div>
                <div class="sigbox"><svg></svg></div>
                <div class="signer"><span>${m.who === 'Lea' ? 'Lea Brunner' : 'Marco Rossi'}</span><span class="hash"></span></div>
                <button class="btn ink sm sign">${I('pen')} Sign ${m.k}</button>
              </div>`).join('')}
          </div>
          <div class="card sign-total">
            <div><div class="eyebrow">Judgment earned so far</div><div class="bar" style="margin-top:10px">${MS.map((m, i) => `<i data-k="${m.k}" style="background:${shades[i]}"></i>`).join('')}</div></div>
            <div class="amt">CHF 0</div>
            <div class="note">Alpina can stop after any milestone and pays only for what is signed.</div>
            <div class="note" style="text-align:right">of ${chf(5700)}</div>
          </div>
        </div>`;
      await wait(700);
      let total = 0;
      const hashes = ['4c1a…e2f0', '9b07…13cd', 'e5d2…7a41', '1f8c…b6e9', '70aa…c3d5'];
      for (let i = 0; i < MS.length; i++) {
        const m = MS[i];
        const card = $(`.sc[data-k="${m.k}"]`, el);
        const btn = card.querySelector('.sign');
        await act(btn, m.who);
        btn.style.visibility = 'hidden';
        await drawSig(card.querySelector('.sigbox svg'), 11 + i * 7, 650);
        card.appendChild(h('<div class="stamp">SIGNED</div>'));
        card.classList.add('signed');
        card.querySelector('.signer .hash').textContent = `ed25519 ${hashes[i]}`;
        Sound.stamp();
        await wait(120);
        Sound.cash();
        countUp(card.querySelector('.amt'), m.chf, { ms: 650, fmt: num });
        const from = total;
        total += m.chf;
        $(`.sign-total .bar i[data-k="${m.k}"]`, el).style.width = `${m.w * 100}%`;
        countUp($('.sign-total .amt', el), total, { from, ms: 700 });
        Rail.set(m.k, 'signed', `Signed by ${m.who}`);
        Rail.pct(80 + (i + 1) * 3);
        await wait(450);
      }
      Rail.act('Judgment complete · deliverable signature next');
    },
  });

  // 10 · The manager signs the deliverable: the Signature line, and KPMG's liability.
  scene({
    id: 'deliverable', title: 'Deliverable signed', side: 'frontend', hold: 5000,
    rail: { pct: 95, earned: 5700, act: 'Judgment complete · deliverable signature next', items: { M1: ['signed', 'Signed by Lea'], M2: ['signed', 'Signed by Lea'], M3: ['signed', 'Signed by Lea'], M4: ['signed', 'Signed by Lea'], M5: ['signed', 'Signed by Marco'] } },
    async run(el) {
      el.innerHTML = `
        <div class="deliv">
          <div class="card dcard">
            <div class="eyebrow">Deliverable</div>
            <h2 class="h2" style="margin-top:6px">Contract review report · Alpina × SinoGear</h2>
            <div class="dsum"><div><b>5</b><span>milestones signed</span></div><div><b>4</b><span>risks approved</span></div><div><b>5</b><span>redlines</span></div><div><b class="ink-text">1</b><span>trap caught</span></div></div>
            <div class="muted" style="margin-top:18px;font-size:14px">Consequence of error: <b style="color:var(--text)">internal use</b>. Who signs follows the consequence, not the org chart.</div>
            <div class="bigsig"><svg></svg></div>
            <div class="dfoot"><div style="display:flex;gap:12px;align-items:center"><div class="av ink">MR</div><div><b>Marco Rossi</b><div class="muted" style="font-size:12px">Manager, Legal</div></div></div><button class="btn ink" id="signd">${I('pen')} Sign the deliverable</button></div>
          </div>
          <div class="card ladder">
            <div class="eyebrow">Signature · priced by consequence</div>
            <div class="rung on"><b>Internal use</b><span>Manager signs</span><div class="p">${chf(1500)}</div></div>
            <div class="rung"><b>External reliance</b><span>Partner signs</span><div class="p">${chf(4000)}</div></div>
            <div class="rung"><b>Regulatory</b><span>Partner + second partner</span><div class="p">${chf(7500)}</div></div>
            <div class="liab">${I('scale')}<span>The Signature line pays for a named person and KPMG's liability. Never for hours.</span></div>
          </div>
        </div>`;
      await wait(700);
      await act('#signd', 'Marco');
      $('#signd', el).style.visibility = 'hidden';
      await drawSig($('.bigsig svg', el), 97, 1000);
      $('.bigsig', el).appendChild(h('<div class="stamp">SIGNED · KPMG LIABLE</div>'));
      Sound.stamp();
      await wait(150);
      Sound.cash();
      $('.dfoot', el).lastElementChild.replaceWith(h(`<div style="text-align:right" class="pop"><span class="tag gold">Signature line · ${chf(1500)}</span><div class="hash" style="margin-top:6px">Ed25519 · 7c1e…9b20 over 38 decisions + ledger head</div></div>`));
      Rail.addEarn(1500);
      Rail.pct(100);
      Rail.act('Deliverable signed by Marco Rossi');
      await wait(900);
    },
  });

  // 11 · Win.
  scene({
    id: 'win', title: 'Done', side: 'frontend', hold: 4400,
    async run(el) {
      el.innerHTML = `
        <div class="win">
          <div class="win-glow"></div>
          <div style="position:relative">
            <svg class="win-check" viewBox="0 0 170 170"><defs><linearGradient id="winGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#5b9dff"/></linearGradient></defs><circle cx="85" cy="85" r="78"/><path d="M50 88l24 24 48-52"/></svg>
            <h1>Deliverable signed.</h1>
            <div class="wsub">Lea did the judgment. Marco signed. KPMG stands behind it.</div>
            <div class="win-stats">
              <div style="animation-delay:1.5s"><b>5</b><span>milestones signed</span></div>
              <div style="animation-delay:1.62s"><b class="ink-text">1</b><span>planted check caught</span></div>
              <div style="animation-delay:1.74s"><b>2</b><span>AI-only risks learned</span></div>
              <div style="animation-delay:1.86s"><b class="grad-gold">0</b><span>hours billed</span></div>
            </div>
          </div>
        </div>`;
      Sound.win();
      later(500, () => FX.celebrate());
      later(1800, () => FX.small(400, 500));
      later(2100, () => FX.small(1200, 500));
      await wait(2600);
    },
  });

  // 12 · Pricing: milestone by milestone, against the hours model.
  scene({
    id: 'pricing', title: 'Pricing', side: 'business', hold: 9000,
    async run(el) {
      const pct = (v) => `${(v / 10000) * 100}%`;
      el.innerHTML = `
        <div class="pricing">
          <div><div class="eyebrow">Pricing</div><h2 class="h1" style="margin-top:8px">One price per signed milestone. <span class="grad">Not per hour.</span></h2></div>
          <div class="lanes">
            <div class="lane" id="lb"><div class="lbl"><b>Hourly, before AI</b><span>40 h × CHF 250</span></div><div class="track"></div><div class="val muted">—</div></div>
            <div class="lane" id="lc"><div class="lbl"><b>Hourly, with AI</b><span>Same model, fewer hours</span></div><div class="track"></div><div class="val" style="color:var(--bad)">—</div></div>
            <div class="lane" id="la"><div class="lbl"><b class="grad">Countersign</b><span>Judgment + Signature</span></div><div class="track"></div><div class="val" style="position:relative">—</div></div>
          </div>
          <div class="bottom">
            <div class="card claim invisible"><div class="eyebrow">Why it wins</div><div class="big" style="margin-top:10px">Clients pay for judgment and liability. <span class="grad">AI efficiency becomes margin</span>, not lost revenue.</div></div>
            <div class="card opts invisible"><div class="eyebrow">Same two lines, every commercial option</div>
              <div class="row2"><span class="tag ink">Per deliverable</span><span class="tag ink">Retainer · 12 a year, −15%</span><span class="tag ink">Client platform · Judgment × 0.55</span><span class="tag gold">Fees at risk · up to 20% of Judgment</span><span class="tag plain">Classic hourly</span></div>
              <div class="muted" style="font-size:12.5px;margin-top:10px">Each department's policy pack decides which it may sell.</div></div>
          </div>
        </div>`;
      await wait(600);
      // before AI
      const lb = $('#lb .track', el);
      lb.appendChild(h(`<div class="seg h" style="left:0;width:${pct(10000)}"><b>40 hours</b><span>billed by the hour</span></div>`));
      Sound.whoosh();
      await wait(400);
      await countUp($('#lb .val', el), 10000, { ms: 700 });
      await wait(400);
      // with AI, still hourly
      const lc = $('#lc .track', el);
      const segC = h(`<div class="seg h ai" style="left:0;width:${pct(10000)}"><b>hours shrink</b><span>revenue falls with every hour AI saves</span></div>`);
      lc.appendChild(segC);
      $('#lc .val', el).textContent = chf(10000);
      await wait(500);
      segC.style.width = pct(2200);
      Sound.alert();
      $('#lc .val', el).textContent = '↓ falling';
      await wait(1500);
      // Countersign, milestone by milestone
      const la = $('#la .track', el);
      let left = 0;
      for (const m of MS) {
        la.appendChild(h(`<div class="seg j" style="left:calc(${pct(left)} + 2px);width:calc(${pct(m.chf)} - 4px)"><b>${num(m.chf)}</b><span>${m.k}</span></div>`));
        countUp($('#la .val', el), left + m.chf, { from: left, ms: 380 });
        left += m.chf;
        Sound.cash();
        await wait(450);
      }
      la.appendChild(h(`<div class="seg s" style="left:calc(${pct(left)} + 2px);width:calc(${pct(1500)} - 4px)"><b>1,500</b><span>Signature</span></div>`));
      Sound.stamp();
      await countUp($('#la .val', el), 7200, { from: left, ms: 600 });
      $('#la .val', el).appendChild(h(`<span class="tag ok save-badge">Client saves 28%</span>`));
      $('#la', el).appendChild(h(`<div class="lane-note">Each block is billed when its milestone is signed. Stop after any one, pay only for what is signed.</div>`));
      Sound.ok();
      await wait(600);
      $('.claim', el).classList.remove('invisible');
      $('.claim', el).classList.add('pop');
      await wait(400);
      $('.opts', el).classList.remove('invisible');
      $('.opts', el).classList.add('pop');
    },
  });

  // 13 · What the client sees: a one-page trail and a ledger that proves it.
  scene({
    id: 'client', title: 'Client view', side: 'frontend', hold: 7000,
    async run(el) {
      const rows = [
        ['M1 · Key-term extraction', 'Lea Brunner', 'AI extracted 11 terms; Lea corrected 1', 570],
        ['M2 · Benchmark', 'Lea Brunner', '4 deviations confirmed against 1,240 agreements', 855],
        ['M3 · Risk screening', 'Lea Brunner', 'Blind first pass; 4 risks approved, 1 planted check rejected', 1995],
        ['M4 · Redlines', 'Lea Brunner', '5 redlines; the price cap rewritten by Lea', 1425],
        ['M5 · Negotiation priorities', 'Marco Rossi', '3 priorities ranked', 855],
        ['Signature · internal use', 'Marco Rossi', 'Deliverable signed; KPMG liable', 1500],
      ];
      el.innerHTML = `
        <div class="client">
          <div class="paper">
            <div class="ph"><div><div class="eyebrow">Alpina Pumps AG · client view</div><h2>Engagement trail: supply agreement with SinoGear</h2></div><div style="text-align:right;font-size:12px;color:#6b7080">One page<br>Every decision has a name</div></div>
            <table>
              <thead><tr><th>Step</th><th>Checked by</th><th>What happened</th><th class="r">CHF</th></tr></thead>
              <tbody></tbody>
              <tfoot><tr><td colspan="3">Total</td><td class="r">7,200</td></tr></tfoot>
            </table>
            <div class="ver-slot"></div>
          </div>
          <div class="card chain">
            <div class="eyebrow">Tamper-proof ledger</div>
            <div class="h3" style="margin-top:6px">Verifying the hash chain</div>
            <div class="muted" style="font-size:12.5px;margin-top:6px">Every decision is an event linked to the one before. Edit one and the chain breaks at exactly that point.</div>
            <div class="blocks">${Array.from({ length: 36 }, (_, i) => `<div class="blk">${i + 1}</div>`).join('')}</div>
            <div class="res-slot"></div>
          </div>
        </div>`;
      const tb = $('tbody', el);
      await wait(700);
      for (const [step, who, what, v] of rows) {
        tb.appendChild(h(`<tr><td><b>${step}</b></td><td class="ink-c">${who}</td><td>${what}</td><td class="r">${num(v)}</td></tr>`));
        Sound.tick();
        await wait(160);
      }
      await wait(300);
      const blks = $$('.blk', el);
      for (let i = 0; i < blks.length; i++) {
        blks[i].classList.add('v');
        if (i % 3 === 0) Sound.tick();
        await wait(55);
      }
      $('.res-slot', el).appendChild(h(`<div class="res"><b>${I('chain')} Chain verified</b><span>36 of 36 events · head 9d60…40ed · nothing edited</span></div>`));
      $('.ver-slot', el).appendChild(h(`<div class="verified">${I('shield')} Record verified · signed by named people · tamper-proof chain</div>`));
      Sound.ok();
    },
  });

  // 14 · Zoom out: the same unit across the whole firm, then the closing line.
  scene({
    id: 'firm', title: 'Whole firm', side: 'business', hold: 0,
    async run(el) {
      const D = [
        ['Legal', true, [['Commercial contract review', 5700, 1500, 10000, 'internal use'], ['NDA triage', 850, 250, 1500, 'internal use']]],
        ['Tax', false, [['Corporate tax return', 6500, 2500, 12600, 'regulatory'], ['Tax opinion', 11000, 12000, 31000, 'external reliance']]],
        ['Audit & Assurance', false, [['Journal-entry testing', 17000, 4000, 27600, 'engagement fee · lines measured internally']]],
        ['Deal Advisory', false, [['Financial due diligence', 42000, 15000, 78000, 'external reliance'], ['M&A lead advisory', 80000, 5000, 120000, 'internal use · fees at risk allowed']]],
        ['Consulting', false, [['Operating-model diagnostic', 52000, 2000, 78000, 'internal use · fees at risk allowed']]],
        ['Risk & ESG', false, [['CSRD reporting readiness', 22000, 12000, 41600, 'regulatory']]],
      ];
      el.innerHTML = `
        <div class="firm">
          <div class="hd"><div class="eyebrow">Not a contract tool</div><h2 class="h1" style="margin-top:8px">One unit across the whole firm</h2><div class="muted" style="margin-top:8px;font-size:15px">6 departments · 9 services · every price is Judgment + Signature · Tier 2, CHF, illustrative</div></div>
          <div class="depts">
            ${D.map(([name, here, svcs], i) => `
              <div class="card dept ${here ? 'here' : ''}" style="animation-delay:${here ? 0 : 250 + i * 140}ms">
                <div class="dn"><b>${name}</b>${here ? '<span class="tag ink">You just saw this</span>' : ''}</div>
                ${svcs.map(([s, j, sg, hr, m]) => `
                  <div class="svc"><span>${s}</span><span class="p"><span class="ai-text">${num(j)}</span> + <span class="ink-text">${num(sg)}</span></span><span class="m">${m}</span><span class="h">${num(hr)} hourly</span></div>`).join('')}
              </div>`).join('')}
          </div>
          <div class="guard" style="animation-delay:1.4s">${I('shield')} Policy packs decide what each department may sell. Audit clients can never have outcome-linked fees.</div>
        </div>`;
      Sound.whoosh();
      for (let i = 0; i < 6; i++) later(250 + i * 140, () => Sound.tick());
      await wait(6500);
      stage.appendChild(h(`
        <div class="finale">
          <div>
            <svg class="logo" viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="url(#markGrad)" stroke-width="2.4"/><path d="M9 17.5l4.2 4.2L23.5 11" fill="none" stroke="url(#markGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <h1>Countersign</h1>
            <p>The billable unit when AI does the work: a signed professional judgment.</p>
            <div class="tl"><span class="tag ai" style="height:40px;padding:0 18px;font-size:15px">AI does the work</span><span class="tag ink" style="height:40px;padding:0 18px;font-size:15px">People decide and sign</span><span class="tag gold" style="height:40px;padding:0 18px;font-size:15px">Clients pay for judgment</span></div>
          </div>
        </div>`));
      Sound.chord();
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
    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(k)) { e.preventDefault(); next(); }
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
  window.countersign = { go, next, prev, start, setMode, state: S, scenes: SCENES.map((s) => s.id) };
})();
