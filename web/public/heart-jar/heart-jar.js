/*!
 * <heart-jar> — animated donation jar
 *
 * Usage
 *   1. load heart-jar-assets.js   (images + layout, sets window.HeartJarAssets)
 *   2. load heart-jar.js          (defines the <heart-jar> element)
 *   <heart-jar amount="12500" goal="50000"></heart-jar>   // goal mode
 *   <heart-jar amount="12500"></heart-jar>                // no-goal mode
 *
 * Attributes / properties
 *   amount       total raised so far (number)
 *   goal         target amount; leave out or 0 for "no goal"
 *   soft-scale   no-goal mode only: amount at which the jar looks ~63% full (default 10000)
 *   animate-on-load  hearts fall in when the element first appears (otherwise it starts filled)
 *   static       never animate (use for small jars in lists)
 *   keep-size    don't zoom out when overflowing; the spill draws outside the box instead
 *
 * Methods
 *   jar.donate(n)           adds n to amount and animates
 *   jar.setAmount(n)        sets the total and animates to it
 *   jar.reset()             empties the jar
 *
 * Events (bubble, composed)
 *   heartjar:filling    detail { from, to, duration, startedAt, amount, goal, percent }
 *                       hearts start to fall: fill goes from -> to over duration ms
 *                       (also kept as jar.lastFilling)
 *   heartjar:progress   detail { amount, goal, percent, fill }
 *   heartjar:goalreached detail { amount, goal }
 *   heartjar:settled     detail { amount, goal, percent }   every falling heart has landed
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  // falling with a tiny settle bounce
  const fall = t => {
    if (t < 0.78) { const u = t / 0.78; return u * u; }
    const u = (t - 0.78) / 0.22; return 1 - Math.sin(u * Math.PI) * 0.035;
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  class HeartJar extends HTMLElement {
    static get observedAttributes() { return ['amount', 'goal', 'soft-scale']; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._fill = 0;           // visual fill currently shown (0..1)
      this._overflow = false;
      this._anims = new Set();
      this._raf = null;
      this._goalFired = false;
    }

    connectedCallback() {
      if (!this._built) this._build();
      const intro = this.hasAttribute('animate-on-load') && !this.hasAttribute('static') && !reduceMotion();
      this._update(!intro);
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = null; }
    attributeChangedCallback() { if (this._built) this._update(false); }

    get amount() { return Math.max(0, parseFloat(this.getAttribute('amount')) || 0); }
    set amount(v) { this.setAttribute('amount', String(v)); }
    get goal() { return Math.max(0, parseFloat(this.getAttribute('goal')) || 0); }
    set goal(v) { if (!v) this.removeAttribute('goal'); else this.setAttribute('goal', String(v)); }
    get softScale() { return parseFloat(this.getAttribute('soft-scale')) || 10000; }

    donate(n) { this._donated = true; this.amount = this.amount + (+n || 0); }
    setAmount(n) { this.amount = +n || 0; }
    reset() { this.amount = 0; }

    get percent() { return this.goal ? Math.min(1, this.amount / this.goal) : null; }

    // ---------- build the SVG once ----------
    _build() {
      const A = window.HeartJarAssets;
      if (!A) { this._root.textContent = 'heart-jar: load heart-jar-assets.js first.'; return; }
      const L = A.layout;
      this._L = L;
      this._root.innerHTML = `<style>
        :host{display:block;width:100%;max-width:520px;aspect-ratio:${L.viewJar[2]}/${L.viewJar[3]};}
        svg{width:100%;height:100%;display:block;overflow:visible}
      </style>`;
      const svg = el('svg', { viewBox: L.viewJar.join(' '), role: 'img', 'aria-label': 'Donation jar' }, this._root);
      this._svg = svg;
      const defs = el('defs', {}, svg);
      for (const c in A.hearts) {
        const [w, h] = L.hearts[c];
        el('image', { id: 'h-' + c, width: w, height: h, href: A.hearts[c] }, defs);
      }
      defs.insertAdjacentHTML('beforeend', `
        <clipPath id="inside"><path d="M120 -4000 L520 -4000 L520 24 L120 24 Z"/><path d="M112 14 L528 14 L534 200 Q600 215 604 300 L604 860 Q604 945 500 945 L140 945 Q36 945 36 860 L36 300 Q40 215 106 200 Z"/></clipPath>
        <radialGradient id="contact" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0a1440" stop-opacity=".45"/><stop offset="1" stop-color="#0a1440" stop-opacity="0"/></radialGradient>
        <radialGradient id="jarShadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0a1440" stop-opacity=".3"/><stop offset="1" stop-color="#0a1440" stop-opacity="0"/></radialGradient>
        <linearGradient id="edgeTint" x1="0" x2="1"><stop offset="0" stop-color="#0b2a8a" stop-opacity=".35"/><stop offset=".14" stop-color="#2a5bd8" stop-opacity="0"/><stop offset=".86" stop-color="#2a5bd8" stop-opacity="0"/><stop offset="1" stop-color="#0b2a8a" stop-opacity=".35"/></linearGradient>`);
      const [W, H] = L.size;

      el('ellipse', { cx: 320, cy: L.ground, rx: 380, ry: 34, fill: 'url(#jarShadow)' }, svg);
      const gShadOut = el('g', {}, svg);
      const gGroundBack = el('g', {}, svg);
      el('image', { width: W, height: H, href: A.jarBack }, svg);
      const gFloorShad = el('g', {}, svg);
      const gInside = el('g', { 'clip-path': 'url(#inside)' }, svg);
      const layers = { deep: el('g', {}, gInside), back: el('g', {}, gInside), front: el('g', {}, gInside) };
      el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#edgeTint)' }, gInside);
      el('image', { width: W, height: H, href: A.jarFront }, svg);
      const gHeap = el('g', {}, svg), gRim = el('g', {}, svg), gGroundFront = el('g', {}, svg);
      this._gFly = el('g', {}, svg);   // hearts in the air above everything

      const makeHeart = (d, parent) => {
        const [w, h] = L.hearts[d.c];
        const g = el('g', { visibility: 'hidden' }, parent);
        el('use', { href: '#h-' + d.c, transform: `translate(${-w / 2} ${-h / 2})` }, g);
        const k = d.s / w;
        const item = { d, g, k, shown: false, parent };
        this._place(item, d.x, d.y, d.r, 1);
        return item;
      };
      const makeShadow = (x, y, rx, parent) =>
        el('ellipse', { cx: x, cy: y, rx, ry: Math.max(4, rx * 0.13), fill: 'url(#contact)', opacity: 0 }, parent);

      this._inner = L.inner.map(d => {
        const it = makeHeart(d, layers[d.l]);
        if (d.sh) it.shadow = makeShadow(d.sh[0], d.sh[1], d.sh[2], gFloorShad);
        return it;
      });
      // inner hearts are already sorted by depth/height for drawing; reveal order uses threshold
      this._revealOrder = [...this._inner].sort((a, b) => a.d.t - b.d.t || b.d.y - a.d.y);

      this._heap = L.heap.map(d => makeHeart(d, gHeap)).reverse(); // bottom rows first
      this._heap.sort((a, b) => b.d.y - a.d.y);
      this._rim = L.rim.map(d => makeHeart(d, gRim));
      const ground = (list, parent, shadowY) => list.map(d => {
        const it = makeHeart(d, parent);
        it.shadow = makeShadow(d.x, shadowY, d.s * 0.5, gShadOut);
        return it;
      });
      this._groundBack = ground(L.groundBack, gGroundBack, L.ground - 10);
      this._groundFront = ground(L.groundFront, gGroundFront, L.ground + 18);
      this._view = L.viewJar.slice();
      this._built = true;
    }

    _place(it, x, y, r, s) {
      it.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r.toFixed(1)}) scale(${(it.k * s).toFixed(4)})`);
    }

    // ---------- fill target ----------
    _targetFill() {
      const a = this.amount, g = this.goal;
      if (g) return Math.min(1, a / g);
      return 0.92 * (1 - Math.exp(-a / this.softScale));    // never quite full without a goal
    }

    _update(initial) {
      if (!this._built) return;
      let target = this._targetFill();
      const instant = initial || reduceMotion() || this.hasAttribute('static');
      const goalMode = !!this.goal;
      const reached = goalMode && this.amount >= this.goal;

      // in no-goal mode every donation should visibly add at least one heart
      if (!goalMode && this._donated && target > this._fill) {
        const next = this._revealOrder.find(it => !it.shown && it.d.t > 0);
        if (next && next.d.t > target) target = Math.min(0.92, next.d.t);
      }
      this._donated = false;
      // any money at all shows at least one heart
      if (this.amount > 0 && this._revealOrder.length && target < this._revealOrder[0].d.t) target = this._revealOrder[0].d.t;

      // emptying / lowering
      if (target < this._fill || (!reached && this._overflow)) {
        if (!reached && this._overflow) this._setOverflow(false, true);
        for (const it of this._inner) if (it.shown && it.d.t > target) this._hide(it);
        this._fill = target;
        if (!reached) this._goalFired = false;
      }

      // filling up
      const from = this._fill;
      const toShow = this._revealOrder.filter(it => !it.shown && it.d.t <= target + 1e-6);
      this._fill = Math.max(this._fill, target);
      let endTime = 0;
      if (instant) toShow.forEach(it => this._showNow(it));
      else {
        const n = toShow.length;
        const gap = n ? Math.min(55, 2600 / n) : 0;
        toShow.forEach((it, i) => { endTime = Math.max(endTime, i * gap + this._drop(it, i * gap)); });
      }
      // How long the hearts take, so a progress bar can fill alongside and
      // stop with the last one. Kept on the element too (jar.lastFilling) for
      // a listener that arrives a moment late, and sent after this task, once
      // the page has had the chance to listen.
      if (!instant && toShow.length) {
        const detail = { from, to: this._fill, duration: Math.round(endTime), startedAt: performance.now(),
          amount: this.amount, goal: this.goal || null, percent: this.percent };
        this.lastFilling = detail;
        setTimeout(() => this.dispatchEvent(new CustomEvent('heartjar:filling', { bubbles: true, composed: true, detail })), 0);
      }

      if (reached && !this._overflow) {
        if (instant) this._setOverflow(true, true);
        else { this._overflowPending = true; setTimeout(() => { this._overflowPending = false; this._setOverflow(true, false); }, endTime + 150); }
      }
      if (reached && !this._goalFired) {
        this._goalFired = true;
        if (!initial) setTimeout(() => this.dispatchEvent(new CustomEvent('heartjar:goalreached',
          { bubbles: true, composed: true, detail: { amount: this.amount, goal: this.goal } })), endTime);
      }
      if (instant && !this._anims.size) setTimeout(() => this._settled(), 0);
      this.dispatchEvent(new CustomEvent('heartjar:progress', { bubbles: true, composed: true,
        detail: { amount: this.amount, goal: this.goal || null, percent: this.percent, fill: this._fill } }));
    }

    // ---------- animation helpers ----------
    _run(duration, delay, step, done) {
      const a = { start: performance.now() + delay, duration, step, done };
      this._anims.add(a);
      if (!this._raf) this._raf = requestAnimationFrame(t => this._tick(t));
      return a;
    }
    _tick(now) {
      for (const a of this._anims) {
        if (now < a.start) continue;
        const t = Math.min(1, (now - a.start) / a.duration);
        a.step(t);
        if (t >= 1) { this._anims.delete(a); a.done && a.done(); }
      }
      this._raf = this._anims.size ? requestAnimationFrame(t => this._tick(t)) : null;
      if (!this._raf) this._settled();
    }
    _settled() {
      if (this._overflowPending || this._anims.size) return;
      this.dispatchEvent(new CustomEvent('heartjar:settled', { bubbles: true, composed: true,
        detail: { amount: this.amount, goal: this.goal || null, percent: this.percent } }));
    }
    _cancel(it) { if (it.anim) { this._anims.delete(it.anim); it.anim = null; } }

    _showNow(it) {
      this._cancel(it);
      if (it.marker) { it.marker.replaceWith(it.g); it.marker = null; }
      it.shown = true;
      this._place(it, it.d.x, it.d.y, it.d.r, 1);
      it.g.setAttribute('visibility', 'visible');
      it.g.removeAttribute('opacity');
      if (it.shadow) it.shadow.setAttribute('opacity', 1);
    }
    _hide(it) {
      this._cancel(it);
      if (it.marker) { it.marker.replaceWith(it.g); it.marker = null; }
      it.shown = false;
      it.g.setAttribute('visibility', 'hidden');
      if (it.shadow) it.shadow.setAttribute('opacity', 0);
    }

    // ---------- physics-ish motion ----------
    // gravity in jar pixels / s^2 (the jar is ~970px tall)
    get _g() { return 2600; }
    // free fall from p0 to p1 (p1 lower), starting with downward speed v0; x eased toward p1
    _fall(p0, p1, v0, r0, r1, xEase = easeOutCubic) {
      const g = this._g, dy = Math.max(1, p1.y - p0.y);
      const t = (-v0 + Math.sqrt(v0 * v0 + 2 * g * dy)) / g;
      return { seg: { d: t * 1000, f: u => {
        const tt = u * t;
        return [p0.x + (p1.x - p0.x) * xEase(u), p0.y + v0 * tt + 0.5 * g * tt * tt, r0 + (r1 - r0) * u];
      } }, v: v0 + g * t };
    }
    // ballistic hop from p0 to p1 that first rises by `lift`
    _hop(p0, p1, lift, r0, r1) {
      const g = this._g;
      const top = Math.min(p0.y, p1.y) - lift;
      const tUp = Math.sqrt(2 * (p0.y - top) / g), tDown = Math.sqrt(2 * (p1.y - top) / g), t = tUp + tDown;
      const vy0 = -g * tUp;
      return { seg: { d: t * 1000, f: u => {
        const tt = u * t;
        return [p0.x + (p1.x - p0.x) * u, p0.y + vy0 * tt + 0.5 * g * tt * tt, r0 + (r1 - r0) * u];
      } }, v: g * tDown };
    }
    // two damped bounces where it lands
    _bounces(p, impactV, r, dx = 0) {
      const g = this._g, segs = [];
      let h = Math.min(30, (impactV * impactV) / (2 * g) * 0.035), x = p.x;
      const wob = rand(4, 9) * (Math.random() < .5 ? -1 : 1);
      for (let i = 0; i < 2 && h > 1.5; i++) {
        const t = 2 * Math.sqrt(2 * h / g), hh = h, x0 = x, x1 = i ? p.x : p.x + dx, w = i ? -wob * .4 : wob;
        segs.push({ d: t * 1000, f: u => [x0 + (x1 - x0) * u, p.y - 4 * hh * u * (1 - u), r + w * Math.sin(u * Math.PI)] });
        x = x1; h *= 0.28;
      }
      return segs;
    }
    // run a list of segments; flags: fly (start above everything), home (segment index that returns it to its layer)
    _motion(it, segs, delay, opts = {}) {
      this._cancel(it);
      it.shown = true;
      const total = segs.reduce((a, s) => a + s.d, 0);
      const starts = []; segs.reduce((a, s) => (starts.push(a), a + s.d), 0);
      let flying = false;
      const goHome = () => { if (flying && it.marker) { it.marker.replaceWith(it.g); it.marker = null; } flying = false; };
      it.anim = this._run(total, delay, t => {
        if (it.g.getAttribute('visibility') !== 'visible') {
          it.g.setAttribute('visibility', 'visible');
          if (opts.fly) { it.marker = document.createComment(''); it.g.replaceWith(it.marker); this._gFly.appendChild(it.g); flying = true; }
        }
        const ms = t * total;
        let i = starts.length - 1; while (i > 0 && starts[i] > ms) i--;
        if (opts.home != null && i >= opts.home) goHome();
        const u = segs[i].d ? Math.min(1, (ms - starts[i]) / segs[i].d) : 1;
        const [x, y, r] = segs[i].f(u);
        this._place(it, x, y, r, 1);
        if (it.shadow && opts.shadowAt != null) it.shadow.setAttribute('opacity', i >= opts.shadowAt ? 1 : 0);
      }, () => { goHome(); it.anim = null; this._place(it, it.d.x, it.d.y, it.d.r, 1); if (it.shadow) it.shadow.setAttribute('opacity', 1); });
      return total;
    }

    // inside the jar: falls from high above, drops through the mouth and bounces onto the pile
    _drop(it, delay) {
      const d = it.d, top = this._view[1];
      const xm = Math.max(150, Math.min(490, 320 + (d.x - 320) * 0.45 + rand(-40, 40)));  // where it passes the mouth
      const p0 = { x: Math.max(140, Math.min(500, xm + rand(-60, 60))), y: top - rand(120, 320) };
      const spin = rand(-260, 260), r0 = d.r + spin, rm = d.r + spin * 0.6;
      const a = this._fall(p0, { x: xm, y: 20 }, 0, r0, rm, u => u);
      const b = this._fall({ x: xm, y: 20 }, { x: d.x, y: d.y }, a.v, rm, d.r, easeOutCubic);
      return this._motion(it, [a.seg, b.seg, ...this._bounces(d, b.v, d.r, rand(-6, 6))], delay, { shadowAt: 2 });
    }

    // heap on top: hearts rain down from above and land on the growing pile over the mouth
    _rain(it, delay) {
      const d = it.d, top = this._L.viewOverflow[1];
      const p0 = { x: d.x + rand(-50, 50), y: top - rand(120, 300) };
      const a = this._fall(p0, d, 0, d.r + rand(-240, 240), d.r);
      return this._motion(it, [a.seg, ...this._bounces(d, a.v, d.r, rand(-8, 8))], delay);
    }

    // ground: falls onto the heap, rolls off the edge, slides past the shoulder and drops to the ground
    _cascade(it, delay) {
      const d = it.d, top = this._L.viewOverflow[1];
      const side = d.x < 320 ? -1 : 1;
      const ex = 320 + side * rand(150, 225);                   // lands near the edge of the heap
      const ey = 34 - (225 - Math.abs(ex - 320)) * 0.35;
      const p0 = { x: ex + rand(-30, 30), y: top - rand(120, 300) };
      const sx = 320 + side * rand(345, 375), sy = rand(150, 220); // just outside the shoulder
      const r0 = d.r + rand(-200, 200);
      const a = this._fall(p0, { x: ex, y: ey }, 0, r0, r0 + 40 * side);
      const roll = this._hop({ x: ex, y: ey }, { x: sx, y: sy }, rand(8, 22), r0 + 40 * side, r0 + 200 * side);
      const drop = this._fall({ x: sx, y: sy }, d, roll.v * 0.6, r0 + 200 * side, d.r, u => u);
      const bnc = this._bounces(d, drop.v, d.r, rand(4, 12) * side);
      // a short settle on the heap edge before tipping over
      const rest = { d: rand(60, 160), f: () => [ex, ey, r0 + 40 * side] };
      return this._motion(it, [a.seg, rest, roll.seg, drop.seg, ...bnc], delay, { fly: true, home: 3, shadowAt: 4 });
    }

    _animateView(to, dur) {
      if (this.hasAttribute('keep-size')) to = this._L.viewJar;
      const from = this._view.slice();
      if (this._viewAnim) this._anims.delete(this._viewAnim);
      if (!dur) { this._view = to.slice(); this._svg.setAttribute('viewBox', to.join(' ')); return; }
      this._viewAnim = this._run(dur, 0, t => {
        const e = easeInOut(t);
        this._view = from.map((v, i) => v + (to[i] - v) * e);
        this._svg.setAttribute('viewBox', this._view.map(v => v.toFixed(2)).join(' '));
      });
    }

    _setOverflow(on, instant) {
      const L = this._L;
      this._overflow = on;
      const all = [...this._heap, ...this._rim, ...this._groundBack, ...this._groundFront];
      if (!on) {
        all.forEach(it => this._hide(it));
        this._animateView(L.viewJar, instant ? 0 : 700);
        return;
      }
      if (instant) { all.forEach(it => this._showNow(it)); this._animateView(L.viewOverflow, 0); return; }
      this._animateView(L.viewOverflow, 1100);
      // 1) hearts rain onto the top and build the heap, bottom rows first
      let t = 450;
      this._heap.forEach((it, i) => this._rain(it, t + i * 85));
      t += this._heap.length * 85;
      this._rim.forEach((it, i) => this._rain(it, t - 300 + i * 120));
      // 2) more keep coming, roll off the heap and pour down to the ground (lowest land first)
      const ground = [...this._groundBack, ...this._groundFront]
        .map(it => [it, -it.d.y + Math.random() * 30]).sort((a, b) => a[1] - b[1]).map(p => p[0]);
      ground.forEach((it, i) => this._cascade(it, t - 600 + i * 70));
    }
  }

  if (!customElements.get('heart-jar')) customElements.define('heart-jar', HeartJar);
})();
