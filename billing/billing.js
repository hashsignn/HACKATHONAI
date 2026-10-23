/* Trust+ billing: how a fee is calculated, as a presenter-driven animation.
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

  // ------------------------------------------------------------------ data (illustrative KYC case)
  const LANES = {
    A: { key: 'A', name: 'AI-led', who: 'AI does the work · a person spot-checks', rate: 1000, color: '#7213ea' },
    B: { key: 'B', name: 'Mixed', who: 'AI drafts · a person decides', rate: 3000, color: '#0091da' },
    C: { key: 'C', name: 'Human-led', who: 'A person leads · AI assists', rate: 8000, color: '#00338d' },
  };
  const TYPES = [
    ['A', 'Data extraction', 4], ['A', 'Completeness check', 6], ['A', 'Sanctions screening', 5],
    ['B', 'Risk-rating review', 6], ['B', 'Adverse-media triage', 4],
    ['C', 'High-risk decision', 3], ['C', 'Remediation plan', 1], ['C', 'Regulator sign-off', 1],
  ];
  const CHIPS = [];
  TYPES.forEach(([lane, label, n]) => { for (let k = 0; k < n; k++) CHIPS.push({ lane, label }); });
  // a fixed shuffle so the sort into lanes looks like real sorting
  const ORDER = CHIPS.map((c, i) => i).sort((a, b) => ((a * 37 + 11) % 31) - ((b * 37 + 11) % 31));
  const CASE = { A: 15, B: 10, C: 5 };
  const L1 = CASE.A * 1000 + CASE.B * 3000 + CASE.C * 8000; // 85,000
  const L2 = Math.round(L1 * 0.2); // 17,000
  const HOURLY = 209000;
  const BIZ = [
    { k: 'audit', n: 'Audit', ex: 'Data extraction, population testing, reconciliations, audit opinion', mix: [21, 6, 3], tag: 'AI-led → lower fee', obj: null },
    { k: 'fs', n: 'Financial services', ex: 'KYC file review, sanctions screening, risk rating, regulator sign-off', mix: [15, 10, 5], tag: 'Mixed → mid fee', obj: 'KYC backlog cleared by the deadline, with no regulator findings' },
    { k: 'tl', n: 'Tax & legal', ex: 'Data mapping, return preparation, contract review, tax planning', mix: [12, 11, 7], tag: 'Mixed → mid fee', obj: 'Verified tax saving achieved, or dispute won' },
    { k: 'adv', n: 'Advisory', ex: 'Term extraction, benchmarking, risk screening, negotiation plan', mix: [6, 9, 15], tag: 'Human-led → higher fee', obj: 'Client’s must-have contract terms secured' },
  ];
  const l1Of = ([a, b, c]) => a * 1000 + b * 3000 + c * 8000;
  const kchf = (n) => `CHF ${num(n / 1000)}k`;

  // ------------------------------------------------------------------ fee meter (right rail)
  const Rail = {
    built: false,
    cur: { A: 0, B: 0, C: 0, l2: 'none' },
    build() {
      railEl.classList.add('glass-rail');
      railEl.innerHTML = `
        <div class="rail-head"><div class="eyebrow">Fee meter</div><div class="rt">Alpenbank · KYC remediation</div></div>
        <div class="m-block">
          <div class="m-h"><span>Layer 1 · HAAS task fee</span><b class="m-l1">CHF 0</b></div>
          ${['A', 'B', 'C'].map((l) => `
            <div class="m-row" data-l="${l}"><i style="background:${LANES[l].color}">${l}</i><span>${LANES[l].name}</span><em>0 × ${num(LANES[l].rate / 1000)}k</em><b>0</b></div>`).join('')}
        </div>
        <div class="m-block m-l2box none">
          <div class="m-h"><span>Layer 2 · value-added fee</span><b class="m-l2">—</b></div>
          <div class="m-note">Not agreed yet</div>
        </div>
        <div class="m-total"><span>Total fee</span><b>CHF 0</b></div>
        <div class="m-cmp"><span>Billed by the hour before AI</span><s>${chf(HOURLY)}</s></div>`;
      this.built = true;
    },
    total(c = this.cur) { return c.A * 1000 + c.B * 3000 + c.C * 8000 + (c.l2 === 'paid' ? L2 : 0); },
    apply(cfg) {
      if (!this.built) this.build();
      this.cur = { A: 0, B: 0, C: 0, l2: 'none' };
      this.set(cfg, false);
    },
    set(cfg, animate = true) {
      const prevTotal = this.total();
      const next = { ...this.cur, ...cfg };
      for (const l of ['A', 'B', 'C']) {
        const row = railEl.querySelector(`.m-row[data-l="${l}"]`);
        row.querySelector('em').textContent = `${next[l]} × ${num(LANES[l].rate / 1000)}k`;
        const b = row.querySelector('b');
        const v = next[l] * LANES[l].rate;
        if (animate && next[l] !== this.cur[l]) countUp(b, v, { from: this.cur[l] * LANES[l].rate, ms: 700, fmt: num });
        else b.textContent = num(v);
        row.classList.toggle('on', next[l] > 0);
      }
      const l1 = next.A * 1000 + next.B * 3000 + next.C * 8000;
      const l1el = railEl.querySelector('.m-l1');
      const prevL1 = this.cur.A * 1000 + this.cur.B * 3000 + this.cur.C * 8000;
      if (animate) countUp(l1el, l1, { from: prevL1, ms: 700 }); else l1el.textContent = chf(l1);
      const box = railEl.querySelector('.m-l2box');
      box.className = `m-block m-l2box ${next.l2}`;
      const l2el = railEl.querySelector('.m-l2');
      const note = railEl.querySelector('.m-note');
      if (next.l2 === 'none') { l2el.textContent = '—'; note.textContent = 'Not agreed yet'; }
      if (next.l2 === 'agreed') { l2el.textContent = chf(L2); note.textContent = 'Agreed up front · paid only if objectives are met'; }
      if (next.l2 === 'paid') { l2el.textContent = chf(L2); note.textContent = 'Objectives met · earned'; }
      this.cur = next;
      const tEl = railEl.querySelector('.m-total b');
      if (animate) countUp(tEl, this.total(), { from: prevTotal, ms: 800 }); else tEl.textContent = chf(this.total());
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


  // 1 · Why hours break when AI does the work.
  scene({
    id: 'hours', title: 'Why hours break', side: 'business', hold: 6000,
    async run(el) {
      el.innerHTML = `
        <div class="hrs">
          <div><div class="eyebrow">The problem</div><h1 class="h1" style="margin-top:8px">AI makes KPMG 4× faster.<br><span class="bad-text">Hourly billing makes it 4× poorer.</span></h1></div>
          <div class="hlanes">
            <div class="hlane"><div class="lbl"><b>Before AI</b><span>1,100 h × CHF 190</span></div><div class="track"><div class="seg h" id="h1" style="width:0"><b>1,100 hours</b></div></div><div class="val" id="v1">—</div></div>
            <div class="hlane"><div class="lbl"><b>With AI, still hourly</b><span>same work, 300 h</span></div><div class="track"><div class="seg h ai" id="h2" style="width:0"><b>300 hours</b></div></div><div class="val bad-text" id="v2">—</div></div>
          </div>
          <div class="hclaim invisible"><div class="card claim-row"><div class="av ink lg">+</div><div><div class="h2">Trust+ bills <span class="grad">tasks and outcomes</span>, not hours.</div><div class="muted" style="margin-top:6px">Every task priced by who does it. A bonus only when the client's goal is met.</div></div></div></div>
        </div>`;
      await wait(500);
      $('#h1', el).style.width = '100%';
      Sound.whoosh();
      await countUp($('#v1', el), HOURLY, { ms: 900 });
      await wait(500);
      $('#h2', el).style.width = '100%';
      $('#v2', el).textContent = chf(HOURLY);
      await wait(600);
      $('#h2', el).style.width = '27%';
      Sound.alert();
      await countUp($('#v2', el), 57000, { from: HOURLY, ms: 1500 });
      await wait(500);
      $('.hclaim', el).classList.remove('invisible');
      $('.hclaim', el).classList.add('pop');
      Sound.ok();
    },
  });

  // 2 · The engagement is split into tasks.
  scene({
    id: 'tasks', title: 'Project → tasks', side: 'business', hold: 4000,
    rail: { A: 0, B: 0, C: 0, l2: 'none' },
    async run(el) {
      el.innerHTML = `
        <div class="board">
          <div class="card case">
            <div class="eyebrow">Example engagement · fictional</div>
            <div class="h2" style="margin-top:8px">Alpenbank AG</div>
            <div class="muted" style="margin-top:4px">KYC backlog remediation</div>
            <div class="facts2">
              <div><span>Open client files</span><b>12,000</b></div>
              <div><span>Deadline</span><b>31 March</b></div>
              <div><span>Regulator</span><b>FINMA review</b></div>
            </div>
            <div class="ai-reply pop" style="animation-delay:.6s"><div class="av ai">${I('spark')}</div><div class="ai-text">AI splits the engagement into <b>30 tasks</b>, each one priced on its own.</div></div>
          </div>
          <div class="chips-area"></div>
        </div>`;
      Sound.whoosh();
      await wait(900);
      const area = $('.chips-area', el);
      ORDER.forEach((ci, k) => {
        const c = CHIPS[ci];
        const col = k % 4;
        const row = Math.floor(k / 4);
        const n = h(`<div class="tchip" style="left:${col * 195}px;top:${row * 52}px;width:182px;animation-delay:${k * 45}ms"><i></i>${c.label}</div>`);
        area.appendChild(n);
        if (k % 3 === 0) later(k * 45, () => Sound.tick());
      });
      await wait(30 * 45 + 900);
    },
  });

  // 3 · Each task goes into a HAAS lane.
  scene({
    id: 'lanes', title: 'Tasks → HAAS lanes', side: 'business', hold: 6500,
    rail: { A: 0, B: 0, C: 0, l2: 'none' },
    async run(el) {
      el.innerHTML = `
        <div class="board">
          <div class="lane-cols">
            ${['A', 'B', 'C'].map((l) => `
              <div class="lcol card" data-l="${l}" style="--lc:${LANES[l].color}">
                <div class="lhead"><span class="lbadge">${l}</span><div><b>${LANES[l].name}</b><div class="muted" style="font-size:12px">${LANES[l].who}</div></div></div>
                <div class="lrate"><span>≈ ${chf(LANES[l].rate)}</span> per task</div>
                <div class="lcount"><b>0</b> tasks</div>
              </div>`).join('')}
          </div>
          <div class="chips-area full"></div>
        </div>`;
      const area = $('.chips-area', el);
      // final width once the fee meter has slid in (the root is still animating)
      const W = 1600 - 40 - (stage.classList.contains('rail-on') ? 404 : 40);
      const colW = (W - 2 * 18) / 3;
      const chipW = (colW - 24 - 10) / 2;
      const nodes = ORDER.map((ci, k) => {
        const c = CHIPS[ci];
        const col = k % 4;
        const row = Math.floor(k / 4);
        const n = h(`<div class="tchip still" style="left:${370 + col * 195}px;top:${row * 52}px;width:182px"><i></i>${c.label}</div>`);
        area.appendChild(n);
        return { n, c };
      });
      await wait(500);
      const seen = { A: 0, B: 0, C: 0 };
      for (let k = 0; k < nodes.length; k++) {
        const { n, c } = nodes[k];
        const li = 'ABC'.indexOf(c.lane);
        const idx = seen[c.lane]++;
        n.classList.add('sorted');
        n.style.setProperty('--lc', LANES[c.lane].color);
        n.style.left = `${li * (colW + 18) + 12 + (idx % 2) * (chipW + 10)}px`;
        n.style.top = `${150 + Math.floor(idx / 2) * 48}px`;
        n.style.width = `${chipW}px`;
        const cnt = $(`.lcol[data-l="${c.lane}"] .lcount b`, el);
        later(500, () => { cnt.textContent = Number(cnt.textContent) + 1; });
        if (k % 2 === 0) Sound.tick();
        await wait(70);
      }
      await wait(700);
      ['A', 'B', 'C'].forEach((l) => { $(`.lcol[data-l="${l}"] .lcount b`, el).textContent = CASE[l]; });
      Sound.ok();
      $('.board', el).appendChild(h(`<div class="lane-note pop">${I('pen')} The lane is set by who leads the task. Lane C is only billed when a named person made the decision.</div>`));
    },
  });

  // 4 · Layer 1 adds up: Σ tasks × lane rate.
  scene({
    id: 'layer1', title: 'Layer 1 · task fee', side: 'business', hold: 8000,
    rail: { A: 0, B: 0, C: 0, l2: 'none' },
    async run(el) {
      el.innerHTML = `
        <div class="l1">
          <div class="formula card"><span class="f-hl">Fee = Σ (tasks × HAAS lane rate)</span><span class="f-dim">+ value-added fee</span></div>
          <div class="frows">
            ${['A', 'B', 'C'].map((l) => `
              <div class="frow card invisible" data-l="${l}" style="--lc:${LANES[l].color}">
                <span class="lbadge">${l}</span>
                <div class="fn"><b>${LANES[l].name}</b><span>${TYPES.filter((t) => t[0] === l).map((t) => `${t[1]} ×${t[2]}`).join(' · ')}</span></div>
                <div class="fx"><b>${CASE[l]}</b> tasks × <b>${chf(LANES[l].rate)}</b></div>
                <div class="fv">CHF 0</div>
              </div>`).join('')}
          </div>
          <div class="fsum card invisible"><span>Layer 1 · HAAS task-based fee</span><b>CHF 0</b></div>
          <div class="muted l1note invisible">${I('search')} The client sees every task, which lane it was in, and whether AI or a person did it.</div>
        </div>`;
      await wait(600);
      for (const l of ['A', 'B', 'C']) {
        const row = $(`.frow[data-l="${l}"]`, el);
        row.classList.remove('invisible');
        row.classList.add('pop');
        await wait(300);
        Sound.cash();
        countUp(row.querySelector('.fv'), CASE[l] * LANES[l].rate, { ms: 700 });
        Rail.set({ [l]: CASE[l] });
        await wait(800);
      }
      const sum = $('.fsum', el);
      sum.classList.remove('invisible');
      sum.classList.add('pop');
      Sound.stamp();
      await countUp(sum.querySelector('b'), L1, { ms: 800 });
      $('.l1note', el).classList.remove('invisible');
      $('.l1note', el).classList.add('pop');
    },
  });

  // 5 · Layer 2: a value-added fee, paid only if the objectives agreed up front are met.
  scene({
    id: 'layer2', title: 'Layer 2 · value-added fee', side: 'business', hold: 9000,
    rail: { ...CASE, l2: 'none' },
    async run(el) {
      el.innerHTML = `
        <div class="l2">
          <div class="card obj">
            <div class="eyebrow">Agreed up front · 12 January</div>
            <div class="h3" style="margin-top:8px">Objectives</div>
            <div class="olist">
              <div class="oi" data-o="1"><span class="okmark"></span><div><b>Backlog of 12,000 files cleared by 31 March</b><span>Baseline: 12,000 open files</span></div></div>
              <div class="oi" data-o="2"><span class="okmark"></span><div><b>No findings in the FINMA review</b><span>Measured by the regulator, not by KPMG</span></div></div>
            </div>
            <div class="bonus"><span>Value-added fee</span><b>${chf(L2)}</b><em>20% on top of Layer 1 · paid only if both are met</em></div>
          </div>
          <div class="card measure">
            <div class="eyebrow">Result</div>
            <div class="bigcount"><b id="open">12,000</b><span>open files</span></div>
            <div class="pbar"><i></i></div>
            <div class="mrow"><span>FINMA findings</span><b id="find">—</b></div>
            <div style="margin-top:18px"><button class="btn ink" id="measure">${I('check')} Measure the result</button></div>
            <div class="gate-slot"></div>
          </div>
        </div>`;
      await wait(700);
      Rail.set({ l2: 'agreed' });
      Sound.blip(880);
      await wait(900);
      await act('#measure', 'Client');
      $('#measure', el).style.visibility = 'hidden';
      const open = $('#open', el);
      $('.pbar i', el).style.width = '100%';
      await countUp(open, 0, { from: 12000, ms: 1600, fmt: num });
      $('.oi[data-o="1"] .okmark', el).classList.add('on');
      $('.oi[data-o="1"]', el).classList.add('met');
      Sound.ok();
      await wait(500);
      $('#find', el).textContent = '0';
      $('.oi[data-o="2"] .okmark', el).classList.add('on');
      $('.oi[data-o="2"]', el).classList.add('met');
      Sound.ok();
      await wait(400);
      $('.bonus', el).classList.add('paid');
      $('.gate-slot', el).appendChild(h(`<div class="unlock pop">${I('check')} Objectives met · value-added fee earned</div>`));
      Rail.set({ l2: 'paid' });
      Sound.win();
      FX.small(1380, 430);
      await wait(900);
      $('.l2', el).appendChild(h(`<div class="card ifnot pop"><b>If an objective is missed:</b> the client pays Layer 1 only. KPMG carries the risk on the bonus, and the client never pays for a result it did not get.</div>`));
    },
  });

  // 6 · Same model, four businesses: only the lane mix changes.
  scene({
    id: 'four', title: 'Four businesses', side: 'business', hold: 10000,
    async run(el) {
      const max = Math.max(...BIZ.map((b) => l1Of(b.mix)));
      el.innerHTML = `
        <div class="four">
          <div><div class="eyebrow">One model for all four businesses</div><h2 class="h2" style="margin-top:6px">Same formula everywhere. Only the lane mix changes.</h2></div>
          <div class="bcols">
            ${BIZ.map((b, i) => `
              <div class="card bcol ${b.k === 'fs' ? 'here' : ''}" data-b="${b.k}">
                <div class="bn"><b>${b.n}</b>${b.k === 'fs' ? '<span class="tag ink">This case</span>' : ''}</div>
                <div class="bex">${b.ex}</div>
                <div class="mixbar">${['A', 'B', 'C'].map((l, j) => `<i data-l="${l}" style="background:${LANES[l].color};height:0" title="${l}"></i>`).join('')}</div>
                <div class="mixlbl">${b.mix.map((m, j) => `<span><i style="background:${LANES['ABC'[j]].color}"></i>${'ABC'[j]} ${m}</span>`).join('')}</div>
                <div class="bfee"><span>Layer 1 · 30 tasks</span><b>CHF 0</b></div>
                <div class="btag">${b.tag}</div>
                <div class="vbox ${b.obj ? '' : 'none'}">${b.obj
                  ? `<span class="eyebrow">Layer 2 · paid if met</span><div>${b.obj}</div>`
                  : `<span class="eyebrow">Layer 2</span><div>${I('lockS')} No value-added fee: independence rules forbid contingent audit fees</div>`}</div>
              </div>`).join('')}
          </div>
          <div class="rules invisible"><span class="tag ok">${I('check')} Swiss bar rules allow a lawyer's success bonus only on top of a normal base fee. Trust+ already works that way.</span></div>
        </div>`;
      await wait(600);
      for (const b of BIZ) {
        const col = $(`.bcol[data-b="${b.k}"]`, el);
        const fee = l1Of(b.mix);
        const total = fee / max;
        b.mix.forEach((m, j) => {
          const share = (m * [1000, 3000, 8000][j]) / fee;
          col.querySelectorAll('.mixbar i')[j].style.height = `${share * total * 100}%`;
        });
        countUp(col.querySelector('.bfee b'), fee, { ms: 800 });
        Sound.cash();
        await wait(450);
      }
      await wait(500);
      $('.rules', el).classList.remove('invisible');
      $('.rules', el).classList.add('pop');
      Sound.ok();
    },
  });

  // 7 · The invoice and the decision record that links work to result.
  scene({
    id: 'invoice', title: 'Invoice + decision record', side: 'business', hold: 9000,
    async run(el) {
      el.innerHTML = `
        <div class="inv">
          <div class="paper">
            <div class="ph"><div><div class="eyebrow">Invoice · Alpenbank AG</div><h2>KYC backlog remediation</h2></div><div style="text-align:right;font-size:12px;color:#6b7080">Trust+ · one page<br>Every line has a reason</div></div>
            <table>
              <thead><tr><th>What we did · Layer 1</th><th class="r">Tasks</th><th class="r">Rate</th><th class="r">CHF</th></tr></thead>
              <tbody></tbody>
              <tfoot><tr><td colspan="3">Total</td><td class="r" id="itot">0</td></tr></tfoot>
            </table>
            <div class="vs-hourly invisible">Billed by the hour before AI: <s>${chf(HOURLY)}</s> &nbsp;→&nbsp; <b>${chf(L1 + L2)}</b>, the client pays 51% less</div>
          </div>
          <div class="card record">
            <div class="eyebrow">Decision record</div>
            <div class="h3" style="margin-top:6px">Which judgment led to which result</div>
            <div class="recs"></div>
            <div class="rec-foot invisible">${I('chain')} Hash-chained and signed · the link between our work and the result is documented, not guessed</div>
          </div>
        </div>`;
      const tb = $('tbody', el);
      const rows = [
        ['A', 'Lane A · AI-led: extraction, completeness, screening', CASE.A, 1000],
        ['B', 'Lane B · Mixed: risk ratings, adverse media', CASE.B, 3000],
        ['C', 'Lane C · Human-led: high-risk decisions, plan, sign-off', CASE.C, 8000],
      ];
      await wait(600);
      let tot = 0;
      for (const [l, t, n, r] of rows) {
        tb.appendChild(h(`<tr><td><i class="dot" style="background:${LANES[l].color}"></i>${t}</td><td class="r">${n}</td><td class="r">${num(r)}</td><td class="r">${num(n * r)}</td></tr>`));
        countUp($('#itot', el), tot + n * r, { from: tot, ms: 400, fmt: num });
        tot += n * r;
        Sound.tick();
        await wait(350);
      }
      tb.appendChild(h(`<tr class="l2row"><td><b>What you gained · Layer 2:</b> backlog cleared by 31 March, 0 FINMA findings</td><td class="r">—</td><td class="r">20%</td><td class="r">${num(L2)}</td></tr>`));
      countUp($('#itot', el), tot + L2, { from: tot, ms: 500, fmt: num });
      Sound.cash();
      await wait(600);
      $('.vs-hourly', el).classList.remove('invisible');
      $('.vs-hourly', el).classList.add('pop');
      const recs = $('.recs', el);
      for (const [who, ini, what, res] of [
        ['Dr. Anna Keller', 'AK', 'approved the remediation plan, 14 Jan', 'Backlog cleared 28 Mar'],
        ['Marco Rossi', 'MR', 'decided 3 high-risk client exits', '0 FINMA findings'],
        ['Lea Brunner', 'LB', 'reviewed 6 risk ratings, overrode 1', 'Rating upheld by FINMA'],
      ]) {
        recs.appendChild(h(`<div class="rec pop"><div class="av ink">${ini}</div><div><b>${who}</b> ${what}</div><span class="arrow">→</span><span class="tag ok">${res}</span></div>`));
        Sound.blip(900);
        await wait(450);
      }
      $('.rec-foot', el).classList.remove('invisible');
      $('.rec-foot', el).classList.add('pop');
    },
  });

  // 8 · Try it, then the one line for Q&A.
  scene({
    id: 'try', title: 'Try it', side: 'business', hold: 0,
    async run(el) {
      el.innerHTML = `
        <div class="try">
          <div class="card calc">
            <div class="eyebrow">Fee calculator · 30-task engagement</div>
            <div class="bpick">${BIZ.map((b) => `<button class="btn ghost sm" data-b="${b.k}">${b.n}</button>`).join('')}</div>
            <div class="cmix"></div>
            <label class="otoggle"><button class="btn ghost sm" id="obj">${I('check')} Objectives met</button><span class="muted" id="objtxt"></span></label>
            <div class="cres"><div><span>Layer 1</span><b id="c1">—</b></div><div><span>Layer 2</span><b id="c2">—</b></div><div class="ct"><span>Total</span><b id="ct">—</b></div></div>
          </div>
          <div class="oneliner card">
            <div class="eyebrow">In one line</div>
            <p>Task-based pricing shows the client <b class="ink-text">what we did</b>. Outcome-based pricing ties our fee to <b class="grad">what they gained</b>. The Trust+ decision record <b>links the two</b>.</p>
          </div>
        </div>`;
      let cur = 'fs';
      let met = true;
      const render = (animate) => {
        const b = BIZ.find((x) => x.k === cur);
        $$('.bpick button', el).forEach((x) => x.classList.toggle('sel', x.dataset.b === cur));
        $('.cmix', el).innerHTML = b.mix.map((m, j) => {
          const l = 'ABC'[j];
          return `<div class="crow"><span class="lbadge" style="--lc:${LANES[l].color}">${l}</span><span>${LANES[l].name}</span><em>${m} × ${chf(LANES[l].rate)}</em><b>${chf(m * LANES[l].rate)}</b></div>`;
        }).join('');
        const l1 = l1Of(b.mix);
        const l2 = b.obj && met ? Math.round(l1 * 0.2) : 0;
        const ob = $('#obj', el);
        ob.disabled = !b.obj;
        ob.classList.toggle('sel', met && !!b.obj);
        $('#objtxt', el).textContent = b.obj ? (met ? b.obj : 'Objective missed: Layer 1 only') : 'Audit: no value-added fee (independence)';
        const set = (id, v) => (animate ? countUp($(id, el), v, { ms: 500 }) : ($(id, el).textContent = chf(v)));
        set('#c1', l1);
        set('#c2', l2);
        set('#ct', l1 + l2);
      };
      $$('.bpick button', el).forEach((x) => x.addEventListener('click', () => { cur = x.dataset.b; Sound.blip(); render(true); }));
      $('#obj', el).addEventListener('click', () => { met = !met; Sound.blip(met ? 1000 : 500); render(true); });
      render(false);
      await wait(900);
      // a short demo the presenter can drive: Advisory, then a missed objective
      await act($('.bpick button[data-b="adv"]', el), 'You');
      await wait(900);
      await act('#obj', 'You');
      await wait(1200);
      await act('#obj', 'You');
      await wait(600);
      $('.oneliner', el).classList.add('glow');
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
    const labels = { backend: 'Backend', frontend: i === 13 ? 'Client' : 'KPMG workspace', business: 'Trust+ billing' };
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
  window.trustplus = { go, next, prev, start, setMode, state: S, scenes: SCENES.map((s) => s.id) };
})();
