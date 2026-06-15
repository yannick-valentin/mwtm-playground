    const GRAPHEME_RE = new RegExp("\\p{Extended_Pictographic}|\\r|\\n|.", "gu");

    function getChars(text) {
      return [...text.matchAll(GRAPHEME_RE)].map(m => m[0]);
    }

    function fisherYatesShuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    const SIGNS = "§@#$%&[]{}<>/?\\|~`+=_'\"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
    function randomSign() { return SIGNS[Math.floor(Math.random() * SIGNS.length)]; }

    function renderReveal(el, originalChars, revealedCount, scrambleFn) {
      const result = [...originalChars];
      const unrevealedIdx = [];
      let locked = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i] === " ") continue;
        if (locked < revealedCount) { locked++; }
        else { unrevealedIdx.push(i); }
      }
      const scrambled = scrambleFn(unrevealedIdx.map(i => result[i]));
      unrevealedIdx.forEach((idx, i) => result[idx] = scrambled[i]);
      el.innerText = result.join("");
    }

    class HoverShuffleBase {
      constructor(selector, scrambleFn, { progressive = true, stepDuration = 0.05 } = {}) {
        this.scrambleFn  = scrambleFn;
        this.progressive = progressive;
        this.tls = new Map(); // per-element timeline
        this.onEnter = this._onEnter.bind(this);
        this.onLeave = this._onLeave.bind(this);
        this.SCRAMBLE_STEPS = 4;
        this.STEP_DURATION  = stepDuration;
        document.querySelectorAll(selector).forEach(el => {
          el.addEventListener("mouseenter", this.onEnter);
          el.addEventListener("mouseleave", this.onLeave);
        });
      }

      _onEnter(e) {
        const el = e.currentTarget;
        const originalText = el.innerText;
        el.setAttribute("aria-label", originalText);
        const originalChars = getChars(originalText);
        const nonSpaceCount = originalChars.filter(c => c !== " ").length;
        const fn = this.scrambleFn;

        const prev = this.tls.get(el);
        if (prev) prev.kill();

        const tl = gsap.timeline({
          onComplete: () => {
            el.innerText = originalText;
            el.removeAttribute("aria-label");
          }
        });
        this.tls.set(el, tl);

        for (let s = 0; s < this.SCRAMBLE_STEPS; s++)
          tl.add(() => renderReveal(el, originalChars, 0, fn), this.STEP_DURATION * s);

        if (this.progressive)
          for (let r = 1; r <= nonSpaceCount; r++)
            tl.add(
              () => renderReveal(el, originalChars, r, fn),
              this.STEP_DURATION * (this.SCRAMBLE_STEPS + r - 1)
            );
      }

      _onLeave(e) {
        const el = e.currentTarget;
        const tl = this.tls.get(el);
        if (tl) tl.kill();
        const orig = el.getAttribute("aria-label");
        if (orig) el.innerText = orig;
        el.removeAttribute("aria-label");
      }
    }

    const fyFn    = arr => fisherYatesShuffle([...arr]);
    const signsFn = arr => arr.map(() => randomSign());

    new HoverShuffleBase("[data-hover-shuffle-full]",       fyFn,    { progressive: false, stepDuration: 0.07 });
    new HoverShuffleBase("[data-hover-shuffle]",            fyFn,    { progressive: true,  stepDuration: 0.04 });
    new HoverShuffleBase("[data-hover-shuffle-signs-full]", signsFn, { progressive: false, stepDuration: 0.07 });
    new HoverShuffleBase("[data-hover-shuffle-signs]",      signsFn, { progressive: true,  stepDuration: 0.04 });

    // ------------------------------------------------------------------------------

    class AudioWaveText {
      constructor() {
        this.WAVE_HOLD = 0.12;
        this.STEP_DUR  = 0.025;
        this.instances = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-audio-wave-text]").forEach(el => {
          this._buildDOM(el);
          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
        });
      }

      _buildDOM(el) {
        const text = el.textContent.trim();
        el.innerHTML = "";
        el.setAttribute("aria-label", text);

        const charSpans = [];
        [...text.matchAll(GRAPHEME_RE)].map(m => m[0]).forEach(ch => {
          if (ch === " ") {
            const sp = document.createElement("span");
            sp.innerHTML = "&nbsp;";
            el.appendChild(sp);
            charSpans.push(null);
            return;
          }
          const span = document.createElement("span");
          span.className = "aw-char";
          span.textContent = ch;
          el.appendChild(span);
          charSpans.push(span);
        });

        const canvas = document.createElement("canvas");
        canvas.className = "aw-canvas";
        canvas.style.opacity = "0";
        el.appendChild(canvas);

        const strokeWidth = parseFloat(el.dataset.waveStrokeWidth) || 3;
        this.instances.set(el, { el, charSpans, canvas, animId: null, tl: null, clipX: 0, strokeWidth });
      }

      _setupCanvas(inst) {
        const { el, canvas } = inst;
        const rect = el.getBoundingClientRect();
        const dpr  = window.devicePixelRatio || 1;
        canvas.width  = Math.round(rect.width  * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width  = rect.width  + "px";
        canvas.style.height = rect.height + "px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        inst.ctx      = ctx;
        inst.W        = rect.width;
        inst.H        = rect.height;
        inst.fontSize = parseFloat(getComputedStyle(el).fontSize);
      }

      _waveY(x, W, H, fontSize, phase) {
        const env = Math.exp(-Math.pow((x / W - 0.5) / 0.28, 2));
        const amp = (env * 0.80 + 0.20) * Math.sqrt(fontSize) * 3.2;
        const t = (x / W) * Math.PI * 2; // 0 → 2π across element width
        const s = Math.sqrt(W / 200);    // cycle scale: 1× at ~200px, ~1.7× at 600px
        return H / 2 + amp * (
          Math.sin(t * 1.5 * s) * Math.sin(phase * 2.1) * 0.50 +
          Math.sin(t * 3.5 * s) * Math.sin(phase * 3.4) * 0.35 +
          Math.sin(t * 7.0 * s) * Math.sin(phase * 1.8) * 0.15
        );
      }

      _draw(inst, phase) {
        const { ctx, W, H, clipX, fontSize } = inst;
        ctx.clearRect(0, 0, W, H);
        ctx.beginPath();
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth   = inst.strokeWidth;
        ctx.lineJoin    = "round";
        ctx.lineCap     = "round";
        let first = true;
        for (let x = Math.ceil(clipX); x <= W; x++) {
          const y = this._waveY(x, W, H, fontSize, phase);
          if (first) { ctx.moveTo(x, y); first = false; }
          else         ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { charSpans, canvas } = inst;

        this._setupCanvas(inst);
        inst.clipX = 0;

        charSpans.forEach(s => { if (s) s.style.opacity = "0"; });
        canvas.style.opacity = "1";

        let phase = 0;
        const loop = () => {
          phase += 0.04;
          this._draw(inst, phase);
          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        const nonNull = charSpans.filter(Boolean);
        const tl = gsap.timeline({ delay: this.WAVE_HOLD });
        nonNull.forEach((span, i) => {
          tl.add(() => {
            span.style.opacity = "1";
            const elRect   = el.getBoundingClientRect();
            const spanRect = span.getBoundingClientRect();
            inst.clipX = spanRect.right - elRect.left;
          }, i * this.STEP_DUR);
        });
        tl.add(() => {
          cancelAnimationFrame(inst.animId);
          canvas.style.opacity = "0";
        });
        inst.tl = tl;
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        if (inst.tl)     { inst.tl.kill(); inst.tl = null; }
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.charSpans.forEach(s => { if (s) s.style.opacity = "1"; });
        inst.canvas.style.opacity = "0";
        inst.clipX = 0;
      }
    }

    new AudioWaveText();

    // ------------------------------------------------------------------------------

    class AudioWaveBold {
      constructor() {
        this.instances = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-audio-wave-bold]").forEach(el => {
          this._buildDOM(el);
          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
        });
      }

      _buildDOM(el) {
        const text = el.textContent.trim();
        el.innerHTML = "";
        el.setAttribute("aria-label", text);

        const charSpans = [];
        [...text.matchAll(GRAPHEME_RE)].map(m => m[0]).forEach(ch => {
          if (ch === " ") {
            const sp = document.createElement("span");
            sp.innerHTML = "&nbsp;";
            el.appendChild(sp);
            charSpans.push(null);
            return;
          }
          const span = document.createElement("span");
          span.className = "aw-char";
          span.textContent = ch;
          el.appendChild(span);
          charSpans.push(span);
        });

        const canvas = document.createElement("canvas");
        canvas.className = "aw-canvas";
        canvas.style.opacity = "0";
        el.appendChild(canvas);

        const strokeWidth    = parseFloat(el.dataset.waveStrokeWidth) || 3;
        const spatialOffset  = Array.from({ length: 3 }, () => Math.random() * Math.PI * 2);
        const spatialOffset2 = Array.from({ length: 3 }, () => Math.random() * Math.PI * 2);
        this.instances.set(el, { el, charSpans, canvas, animId: null, timeouts: [], strokeWidth, spatialOffset, spatialOffset2 });
      }

      _setupCanvas(inst) {
        const { el, canvas } = inst;
        const rect = el.getBoundingClientRect();
        const dpr  = window.devicePixelRatio || 1;
        canvas.width  = Math.round(rect.width  * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width  = rect.width  + "px";
        canvas.style.height = rect.height + "px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        inst.ctx      = ctx;
        inst.W        = rect.width;
        inst.H        = rect.height;
        inst.fontSize = parseFloat(getComputedStyle(el).fontSize);
      }

      _waveY(x, W, H, fontSize, phase, envelope, so) {
        const win = Math.sin(Math.PI * x / W);
        const env = Math.exp(-Math.pow((x / W - 0.5) / 0.28, 2));
        const ampScale = Math.min(Math.sqrt(fontSize) * 4.0, H * 0.45);
        const amp = envelope * win * (env * 0.80 + 0.20) * ampScale;
        const t   = (x / W) * Math.PI * 2;
        const s   = Math.sqrt(W / 200);
        return H / 2 + amp * (
          Math.sin(t * 1.5 * s + so[0]) * Math.sin(phase * 2.1) * 0.50 +
          Math.sin(t * 3.5 * s + so[1]) * Math.sin(phase * 3.4) * 0.35 +
          Math.sin(t * 7.0 * s + so[2]) * Math.sin(phase * 1.8) * 0.15
        );
      }

      _drawWave(ctx, W, H, fontSize, phase, envelope, so, strokeWidth) {
        ctx.beginPath();
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth   = strokeWidth;
        ctx.lineJoin    = "round";
        ctx.lineCap     = "round";
        let first = true;
        for (let x = 0; x <= W; x++) {
          const y = this._waveY(x, W, H, fontSize, phase, envelope, so);
          if (first) { ctx.moveTo(x, y); first = false; }
          else         ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      _draw(inst, phase, envelope) {
        const { ctx, W, H, fontSize, spatialOffset, spatialOffset2 } = inst;
        ctx.clearRect(0, 0, W, H);
        this._drawWave(ctx, W, H, fontSize, phase,                  envelope, spatialOffset,  inst.strokeWidth);
        this._drawWave(ctx, W, H, fontSize, phase + Math.PI / 2.1, envelope, spatialOffset2, inst.strokeWidth);
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { charSpans, canvas } = inst;
        this._setupCanvas(inst);

        const nonNull = charSpans.filter(Boolean);
        nonNull.forEach(s => gsap.set(s, { transformOrigin: "50% 50%" }));

        // Phase 1: squish text down to a line
        inst.squishTween = gsap.to(nonNull, {
          scaleY: 0.1,
          duration: 0.2,
          ease: "power2.in",
          onComplete: () => {
            charSpans.forEach(s => { if (s) s.style.opacity = "0"; });
            canvas.style.opacity = "1";

            // Phase 2: wave ramps in, pulses, ramps out
            const RAMP_IN  = 10;
            const HOLD     = 400;
            const RAMP_OUT = 30;
            const TOTAL    = RAMP_IN + HOLD + RAMP_OUT;
            const smooth   = t => t * t * (3 - 2 * t);

            let phase = 0;
            const startTime = performance.now();

            const loop = (now) => {
              const elapsed = now - startTime;
              let envelope;
              if (elapsed < RAMP_IN) {
                envelope = smooth(elapsed / RAMP_IN);
              } else if (elapsed < RAMP_IN + HOLD) {
                envelope = 1;
              } else {
                envelope = smooth(1 - Math.min((elapsed - RAMP_IN - HOLD) / RAMP_OUT, 1));
              }

              phase += 0.12;
              this._draw(inst, phase, envelope);

              if (elapsed < TOTAL) {
                inst.animId = requestAnimationFrame(loop);
              } else {
                inst.animId = null;
                canvas.style.opacity = "0";

                // Phase 3: restore chars at scaleY 0.1, then scale back up
                charSpans.forEach(s => { if (s) s.style.opacity = "1"; });
                inst.revealTween = gsap.to(nonNull, {
                  scaleY: 1,
                  duration: 0.3,
                  ease: "power2.out",
                });
              }
            };

            inst.animId = requestAnimationFrame(loop);
          }
        });
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        if (inst.squishTween) { inst.squishTween.kill(); inst.squishTween = null; }
        if (inst.revealTween) { inst.revealTween.kill(); inst.revealTween = null; }
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.charSpans.forEach(s => {
          if (s) { s.style.opacity = "1"; gsap.set(s, { scaleY: 1 }); }
        });
        inst.canvas.style.opacity = "0";
      }
    }

    new AudioWaveBold();

    // ------------------------------------------------------------------------------

    class AudioWaveSweep {
      constructor() {
        this.instances = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-audio-wave-sweep]").forEach(el => {
          this._buildDOM(el);
          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
        });
      }

      _buildDOM(el) {
        const text = el.textContent.trim();
        el.innerHTML = "";
        el.setAttribute("aria-label", text);

        // Wrap chars in an inline-block layer so clip-path applies only to text
        const textLayer = document.createElement("span");
        textLayer.style.cssText = "display: inline-block;";

        const charSpans = [];
        [...text.matchAll(GRAPHEME_RE)].map(m => m[0]).forEach(ch => {
          if (ch === " ") {
            const sp = document.createElement("span");
            sp.innerHTML = "&nbsp;";
            textLayer.appendChild(sp);
            charSpans.push(null);
            return;
          }
          const span = document.createElement("span");
          span.className = "aw-char";
          span.textContent = ch;
          textLayer.appendChild(span);
          charSpans.push(span);
        });

        el.appendChild(textLayer);

        const canvas = document.createElement("canvas");
        canvas.className = "aw-canvas";
        canvas.style.opacity = "0";
        el.appendChild(canvas);

        const strokeWidth    = parseFloat(el.dataset.waveStrokeWidth) || 3;
        const spatialOffset  = Array.from({ length: 3 }, () => Math.random() * Math.PI * 2);
        const spatialOffset2 = Array.from({ length: 3 }, () => Math.random() * Math.PI * 2);
        this.instances.set(el, { el, charSpans, textLayer, canvas, animId: null, strokeWidth, spatialOffset, spatialOffset2 });
      }

      _setupCanvas(inst) {
        const { el, canvas } = inst;
        const rect = el.getBoundingClientRect();
        const dpr  = window.devicePixelRatio || 1;
        canvas.width  = Math.round(rect.width  * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width  = rect.width  + "px";
        canvas.style.height = rect.height + "px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        inst.ctx      = ctx;
        inst.W        = rect.width;
        inst.H        = rect.height;
        inst.fontSize = parseFloat(getComputedStyle(el).fontSize);
      }

      _waveY(x, W, H, fontSize, phase, so, ampMult = 1) {
        const env      = Math.exp(-Math.pow((x / W - 0.5) / 0.28, 2));
        const ampScale = Math.min(Math.sqrt(fontSize) * 4.0, H * 0.45);
        const amp      = (env * 0.20 + 0.80) * ampScale * ampMult;
        const t        = (x / W) * Math.PI * 2 * 2;
        const s        = Math.sqrt(W / 200);
        return H / 2 + amp * (
          Math.sin(t * 1.5 * s + so[0]) * Math.sin(phase * 2.1) * 0.50 +
          Math.sin(t * 3.5 * s + so[1]) * Math.sin(phase * 3.4) * 0.35 +
          Math.sin(t * 7.0 * s + so[2]) * Math.sin(phase * 1.8) * 0.15
        );
      }

      _drawWave(ctx, W, H, fontSize, phase, so, strokeWidth, clipFrom, clipTo, ampMult = 1) {
        if (clipTo <= clipFrom) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipFrom, 0, clipTo - clipFrom, H);
        ctx.clip();
        ctx.beginPath();
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth   = strokeWidth;
        ctx.lineJoin    = "round";
        ctx.lineCap     = "round";
        let first = true;
        for (let x = 0; x <= W; x++) {
          const y = this._waveY(x, W, H, fontSize, phase, so, ampMult);
          if (first) { ctx.moveTo(x, y); first = false; }
          else         ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { textLayer } = inst;
        this._setupCanvas(inst);
        const { W, H, fontSize } = inst;

        inst.canvas.style.opacity = "1";

        const SWEEP_IN  = 300; // ms — wave swallows text left → right
        const HOLD      = 150; // ms — both waves animate freely
        const SWEEP_OUT = 300; // ms — wave retreats, text returns left → right
        const TOTAL     = SWEEP_IN + HOLD + SWEEP_OUT;
        const PHASE        = 0.15;  // phase increment per frame — controls wave speed
        const WAVE_OFFSET  = Math.PI / 5; // phase offset between the two waves
        const WAVE2_AMP    = .6;  // Second wave amplitude
        const easeIn    = t => t * t * t;               // slow start, fast end — wave accelerates
        const easeOut   = t => 1 - Math.pow(1 - t, 3); // fast start, slow end — text settles

        let phase = 0;
        const startTime = performance.now();

        const loop = (now) => {
          const elapsed = now - startTime;
          const { ctx } = inst;
          ctx.clearRect(0, 0, W, H);

          let clipFrom, clipTo, sweepX;

          if (elapsed < SWEEP_IN) {
            sweepX   = easeIn(Math.min(elapsed / SWEEP_IN, 1)) * W;
            clipFrom = 0;
            clipTo   = sweepX;
            textLayer.style.clipPath = `inset(0 0 0 ${sweepX}px)`;

          } else if (elapsed < SWEEP_IN + HOLD) {
            clipFrom = 0;
            clipTo   = W;
            textLayer.style.clipPath = `inset(0 0 0 ${W}px)`;

          } else {
            sweepX   = easeOut(Math.min((elapsed - SWEEP_IN - HOLD) / SWEEP_OUT, 1)) * W;
            clipFrom = sweepX;
            clipTo   = W;
            textLayer.style.clipPath = `inset(0 ${W - sweepX}px 0 0)`;
          }

          phase += PHASE;
          this._drawWave(ctx, W, H, fontSize, phase,                  inst.spatialOffset,  inst.strokeWidth, clipFrom, clipTo);
          this._drawWave(ctx, W, H, fontSize, phase + WAVE_OFFSET,     inst.spatialOffset2, inst.strokeWidth, clipFrom, clipTo, WAVE2_AMP);

          if (elapsed < TOTAL) {
            inst.animId = requestAnimationFrame(loop);
          } else {
            inst.animId = null;
            inst.canvas.style.opacity = "0";
            textLayer.style.clipPath  = "";
          }
        };

        inst.animId = requestAnimationFrame(loop);
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.textLayer.style.clipPath = "";
        inst.canvas.style.opacity = "0";
      }
    }

    new AudioWaveSweep();

    // ------------------------------------------------------------------------------

    class AudioWaveDistort {
      constructor() {
        this.WAVE_HOLD = 0.01;
        this.STEP_DUR  = 0.025;
        this.instances = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-audio-wave-distort]").forEach(el => {
          this._buildDOM(el);
          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
        });
      }

      _buildDOM(el) {
        const text = el.textContent.trim();
        el.innerHTML = "";
        el.setAttribute("aria-label", text);

        const charSpans = [], originalChars = [];
        [...text.matchAll(GRAPHEME_RE)].map(m => m[0]).forEach(ch => {
          const span = document.createElement("span");
          span.className = "awd-char";
          span.textContent = ch === " " ? " " : ch;
          el.appendChild(span);
          charSpans.push(span);
          originalChars.push(ch === " " ? " " : ch);
        });

        this.instances.set(el, { el, charSpans, originalChars, animId: null, timeouts: [], locked: new Set() });
      }

      _waveScale(x, W, phase) {
        const env = Math.exp(-Math.pow((x / W - 0.5) / 0.28, 2));
        const amp = (env * 0.80 + 0.20) * 0.25;
        const wave =
          Math.sin(x * 0.022) * Math.sin(phase * 2.1) * 0.32 +
          Math.sin(x * 0.061) * Math.sin(phase * 3.4) * 0.24 +
          Math.sin(x * 0.15 ) * Math.sin(phase * 1.8) * 0.18 +
          Math.sin(x * 0.38 ) * Math.sin(phase * 4.9) * 0.14 +
          Math.sin(x * 0.90 ) * Math.sin(phase * 6.2) * 0.07 +
          Math.sin(x * 2.10 ) * Math.sin(phase * 9.1) * 0.05;
        return 1 + amp * wave;
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { charSpans, originalChars } = inst;

        const elRect = el.getBoundingClientRect();
        const W = elRect.width;
        const xPositions = charSpans.map(s => {
          const r = s.getBoundingClientRect();
          return r.left + r.width / 2 - elRect.left;
        });

        inst.locked.clear();

        // Per-char glitch state
        const glitch = charSpans.map(() => ({ active: false, x: 0, scaleX: 1, opacity: 1, swapped: false }));

        // Snap scaleY values — recomputed every SNAP_EVERY frames, held in between
        const SNAP_EVERY = 10;
        let phase = 0, frameCount = 0;
        const snapScales = charSpans.map(() => 1);

        const loop = () => {
          frameCount++;
          const isSnapFrame = frameCount % SNAP_EVERY === 0;

          if (isSnapFrame) {
            phase += 0.12; // advance by SNAP_EVERY frames worth at once

            // Random group glitch burst
            if (Math.random() < 0.08) {
              const count = 1 + Math.floor(Math.random() * 5);
              for (let k = 0; k < count; k++) {
                const idx = Math.floor(Math.random() * charSpans.length);
                if (!inst.locked.has(idx)) {
                  glitch[idx] = {
                    active:  true,
                    x:       (Math.random() - 0.5) * 28,
                    scaleX:  0.15 + Math.random() * 2.4,
                    opacity: Math.random() < 0.4 ? 0 : 0.3 + Math.random() * 0.7,
                    swapped: Math.random() < 0.45,
                  };
                }
              }
            }

            charSpans.forEach((_, i) => {
              if (!inst.locked.has(i)) snapScales[i] = this._waveScale(xPositions[i], W, phase);
            });
          }

          charSpans.forEach((span, i) => {
            if (inst.locked.has(i)) return;
            const sy = snapScales[i];
            const g  = glitch[i];

            if (g.active && Math.random() < 0.55) {
              g.active = false;
              span.textContent = originalChars[i];
            }

            if (g.active) {
              const gsy = sy * (0.3 + Math.random() * 1.8);
              span.style.transform = `translateX(${g.x}px) scaleX(${g.scaleX}) scaleY(${gsy})`;
              span.style.opacity   = String(g.opacity);
              if (g.swapped) span.textContent = randomSign();
            } else {
              span.style.transform = `scaleY(${sy})`;
              span.style.opacity   = "";
              if (span.textContent !== originalChars[i]) span.textContent = originalChars[i];
            }
          });

          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        // Random-order settle — pure setTimeout, no GSAP
        const indices = charSpans.map((_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        const holdMs = this.WAVE_HOLD * 1000;
        const stepMs = this.STEP_DUR  * 1000;
        inst.timeouts = indices.map((charIdx, step) =>
          setTimeout(() => {
            inst.locked.add(charIdx);
            charSpans[charIdx].textContent    = originalChars[charIdx];
            charSpans[charIdx].style.transform = "";
            charSpans[charIdx].style.opacity   = "";
          }, holdMs + step * stepMs)
        );
        inst.timeouts.push(
          setTimeout(() => cancelAnimationFrame(inst.animId),
            holdMs + indices.length * stepMs)
        );
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        (inst.timeouts || []).forEach(clearTimeout);
        inst.timeouts = [];
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.locked.clear();
        inst.charSpans.forEach((s, i) => {
          s.textContent = inst.originalChars[i];
          s.style.transform = "";
          s.style.opacity   = "";
        });
      }
    }

    new AudioWaveDistort();

    // ------------------------------------------------------------------------------

    class ScanlineDistort {
      constructor() {
        this.SLICE_W     = 2;    // px width of each vertical strip
        this.MAX_OFFSET  = 1.5;  // px max vertical (Y) displacement
        this.SNAP_EVERY  = 2;    // rAF frames between value updates
        this.WAVE_HOLD   = 250;  // ms of full glitch before reveal starts
        this.SETTLE_MS   = 300;  // total ms for the settle phase (fixed, width-independent)
        this.DENSITY     = 1;    // 0–1: fraction of strips with vertical displacement
        this.WRAP_CHANCE = 0.01; // 0–1: probability per strip per snap of getting a horizontal jump
        this.WRAP_RANGE  = 0.6;  // 0–1: max horizontal jump as a fraction of element width
        this.instances  = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-scanline-distort]").forEach(el => {
          el.setAttribute("aria-label", el.textContent.trim());

          // Pre-append canvas once so it never causes a layout shift on hover
          const canvas = document.createElement("canvas");
          canvas.className = "sdw-canvas";
          canvas.style.opacity = "0";
          el.appendChild(canvas);

          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
          this.instances.set(el, { animId: null, timeouts: [], canvas });
        });
      }

      // Render the element's text to an offscreen canvas, matching its computed style.
      // Uses a Range to get the exact Y position of the text within the element.
      _renderSource(el) {
        const style  = getComputedStyle(el);
        const dpr    = window.devicePixelRatio || 1;
        const W      = el.offsetWidth;
        const H      = el.offsetHeight;
        const text   = el.getAttribute("aria-label");


        const src  = document.createElement("canvas");
        src.width  = Math.round(W * dpr);
        src.height = Math.round(H * dpr);
        const ctx  = src.getContext("2d");
        ctx.scale(dpr, dpr);

        ctx.font         = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle    = style.color;
        ctx.textBaseline = "alphabetic";

        // Use font metric ascent/descent (not visual bounding box) to match
        // the browser's own baseline placement inside a line box.
        const m = ctx.measureText(text);
        const y = (H + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
        ctx.fillText(text, 0, y);

        return { src, W, H, dpr };
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { src, W, H, dpr } = this._renderSource(el);
        const { canvas } = inst;

        // Size and show the pre-existing canvas
        canvas.width        = Math.round(W * dpr);
        canvas.height       = Math.round(H * dpr);
        canvas.style.width  = W + "px";
        canvas.style.height = H + "px";
        canvas.style.opacity = "1";

        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        // Hide original text while canvas is active
        el.style.color = "transparent";

        const sliceCount = Math.ceil(W / this.SLICE_W);
        const offsetsY   = new Float32Array(sliceCount); // vertical shift
        const offsetsX   = new Float32Array(sliceCount); // horizontal jump (wrap)
        const locked     = new Set();
        let frameCount   = 0;

        const loop = () => {
          frameCount++;
          ctx.clearRect(0, 0, W, H);

          if (frameCount % this.SNAP_EVERY === 0) {
            for (let i = 0; i < sliceCount; i++) {
              if (locked.has(i)) continue;
              // Vertical displacement
              if (Math.random() < this.DENSITY)
                offsetsY[i] = (Math.random() - 0.5) * this.MAX_OFFSET * 2;
              // Horizontal jump (wrap effect)
              if (Math.random() < this.WRAP_CHANCE)
                offsetsX[i] = (Math.random() - 0.5) * W * this.WRAP_RANGE * 2;
              else if (Math.random() < 0.15)
                offsetsX[i] = 0; // occasionally snap back
            }
          }

          for (let i = 0; i < sliceCount; i++) {
            const x  = i * this.SLICE_W;
            const sw = Math.min(this.SLICE_W, W - x);
            if (sw <= 0) continue;
            ctx.drawImage(src,
              x * dpr, 0, sw * dpr, H * dpr,           // source rect
              x + offsetsX[i], offsetsY[i], sw, H      // dest rect (shifted X and Y)
            );
          }

          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        // Shuffle settle order
        const order = Array.from({ length: sliceCount }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }

        // Derive per-step duration from the fixed settle budget
        const stepDur = this.SETTLE_MS / sliceCount;

        inst.timeouts = order.map((si, step) =>
          setTimeout(() => { locked.add(si); offsetsY[si] = 0; offsetsX[si] = 0; },
            this.WAVE_HOLD + step * stepDur)
        );

        // Restore original text when done
        inst.timeouts.push(setTimeout(() => {
          cancelAnimationFrame(inst.animId); inst.animId = null;
          canvas.style.opacity = "0";
          el.style.color = "";
        }, this.WAVE_HOLD + this.SETTLE_MS + 50));
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        (inst.timeouts || []).forEach(clearTimeout); inst.timeouts = [];
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        if (inst.canvas) inst.canvas.style.opacity = "0";
        el.style.color = "";
      }
    }

    new ScanlineDistort();

    // ------------------------------------------------------------------------------

    class ScanlineDistortH {
      constructor() {
        this.SLICE_H     = 2;    // px height of each horizontal strip
        this.MAX_OFFSET  = 2;    // px max horizontal (X) displacement
        this.SNAP_EVERY  = 1;    // rAF frames between value updates
        this.WAVE_HOLD   = 150;  // ms of full glitch before reveal starts
        this.SETTLE_MS   = 200;  // total ms for the settle phase (width-independent)
        this.DENSITY     = 0.1;  // 0–1: fraction of strips with horizontal displacement
        this.WRAP_CHANCE = 0.01; // 0–1: probability per strip per snap of getting a vertical jump
        this.WRAP_RANGE  = 0.4;  // 0–1: max vertical jump as a fraction of element height
        this.instances  = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-scanline-distort-h]").forEach(el => {
          el.setAttribute("aria-label", el.textContent.trim());

          const canvas = document.createElement("canvas");
          canvas.className = "sdw-canvas";
          canvas.style.opacity = "0";
          el.appendChild(canvas);

          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
          this.instances.set(el, { animId: null, timeouts: [], canvas });
        });
      }

      _renderSource(el) {
        const style = getComputedStyle(el);
        const dpr   = window.devicePixelRatio || 1;
        const W     = el.offsetWidth;
        const H     = el.offsetHeight;
        const text  = el.getAttribute("aria-label");

        const src  = document.createElement("canvas");
        src.width  = Math.round(W * dpr);
        src.height = Math.round(H * dpr);
        const ctx  = src.getContext("2d");
        ctx.scale(dpr, dpr);

        ctx.font         = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle    = style.color;
        ctx.textBaseline = "alphabetic";

        const m = ctx.measureText(text);
        const y = (H + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
        ctx.fillText(text, 0, y);

        return { src, W, H, dpr };
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { src, W, H, dpr } = this._renderSource(el);
        const { canvas } = inst;

        canvas.width        = Math.round(W * dpr);
        canvas.height       = Math.round(H * dpr);
        canvas.style.width  = W + "px";
        canvas.style.height = H + "px";
        canvas.style.opacity = "1";

        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        el.style.color = "transparent";

        // Horizontal strips — count by height
        const sliceCount = Math.ceil(H / this.SLICE_H);
        const offsetsX   = new Float32Array(sliceCount); // horizontal shift
        const offsetsY   = new Float32Array(sliceCount); // vertical jump (wrap)
        const locked     = new Set();
        let frameCount   = 0;

        const loop = () => {
          frameCount++;
          ctx.clearRect(0, 0, W, H);

          if (frameCount % this.SNAP_EVERY === 0) {
            for (let i = 0; i < sliceCount; i++) {
              if (locked.has(i)) continue;
              // Horizontal displacement
              if (Math.random() < this.DENSITY)
                offsetsX[i] = (Math.random() - 0.5) * this.MAX_OFFSET * 2;
              // Vertical jump (Canal+ wrap effect)
              if (Math.random() < this.WRAP_CHANCE)
                offsetsY[i] = (Math.random() - 0.5) * H * this.WRAP_RANGE * 2;
              else if (Math.random() < 0.15)
                offsetsY[i] = 0; // occasionally snap back
            }
          }

          for (let i = 0; i < sliceCount; i++) {
            const y  = i * this.SLICE_H;
            const sh = Math.min(this.SLICE_H, H - y);
            if (sh <= 0) continue;
            ctx.drawImage(src,
              0, y * dpr, W * dpr, sh * dpr,             // source rect (original position)
              offsetsX[i], y + offsetsY[i], W, sh        // dest rect (shifted X and Y)
            );
          }

          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        // Random-order settle
        const order = Array.from({ length: sliceCount }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }

        const stepDur = this.SETTLE_MS / sliceCount;
        inst.timeouts = order.map((si, step) =>
          setTimeout(() => { locked.add(si); offsetsX[si] = 0; offsetsY[si] = 0; },
            this.WAVE_HOLD + step * stepDur)
        );

        inst.timeouts.push(setTimeout(() => {
          cancelAnimationFrame(inst.animId); inst.animId = null;
          canvas.style.opacity = "0";
          el.style.color = "";
        }, this.WAVE_HOLD + this.SETTLE_MS + 50));
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        (inst.timeouts || []).forEach(clearTimeout); inst.timeouts = [];
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        if (inst.canvas) inst.canvas.style.opacity = "0";
        el.style.color = "";
      }
    }

    new ScanlineDistortH();

    // ------------------------------------------------------------------------------

    function resolvedBg(el) {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    }

    class ScanlineTextReveal {
      constructor() {
        this.SLICE_H     = 2;    // px height of each horizontal strip
        this.MAX_OFFSET  = 3;    // px max horizontal (X) displacement
        this.SNAP_EVERY  = 1;    // rAF frames between value updates
        this.WAVE_HOLD   = 150;  // ms of full glitch before reveal starts
        this.STEP_DUR    = 20;   // ms between each character reveal
        this.DENSITY     = 0.05; // fraction of strips with horizontal displacement
        this.WRAP_CHANCE = 0.01; // probability per strip of a vertical jump
        this.WRAP_RANGE  = 0.6;  // max vertical jump as fraction of height
        this.instances   = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-scanline-text-reveal]").forEach(el => {
          this._buildDOM(el);
          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
        });
      }

      _buildDOM(el) {
        const text = el.textContent.trim();
        el.innerHTML = "";
        el.setAttribute("aria-label", text);

        const bg = resolvedBg(el);
        const charSpans = [];
        [...text.matchAll(GRAPHEME_RE)].map(m => m[0]).forEach(ch => {
          const span = document.createElement("span");
          span.style.cssText = `display:inline-block; position:relative; z-index:1; background:${bg};`;
          span.textContent   = ch === " " ? " " : ch;
          el.appendChild(span);
          charSpans.push(span);
        });

        const canvas = document.createElement("canvas");
        canvas.className     = "sdw-canvas";
        canvas.style.opacity = "0";
        canvas.style.zIndex  = "2";
        el.appendChild(canvas);

        this.instances.set(el, { charSpans, canvas, animId: null, timeouts: [] });
      }

      _renderSource(el) {
        const style = getComputedStyle(el);
        const dpr   = window.devicePixelRatio || 1;
        const W     = el.offsetWidth;
        const H     = el.offsetHeight;
        const text  = el.getAttribute("aria-label");

        const src  = document.createElement("canvas");
        src.width  = Math.round(W * dpr);
        src.height = Math.round(H * dpr);
        const ctx  = src.getContext("2d");
        ctx.scale(dpr, dpr);

        ctx.font         = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle    = style.color;
        ctx.textBaseline = "alphabetic";
        const m = ctx.measureText(text);
        ctx.fillText(text, 0, (H + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2);

        return { src, W, H, dpr };
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst = this.instances.get(el);
        const { charSpans, canvas } = inst;
        const { src, W, H, dpr } = this._renderSource(el);

        canvas.width         = Math.round(W * dpr);
        canvas.height        = Math.round(H * dpr);
        canvas.style.width   = W + "px";
        canvas.style.height  = H + "px";
        canvas.style.opacity = "1";

        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        charSpans.forEach(s => { s.style.opacity = "0"; s.style.zIndex = "1"; });

        const sliceCount = Math.ceil(H / this.SLICE_H);
        const offsetsX   = new Float32Array(sliceCount);
        const offsetsY   = new Float32Array(sliceCount);
        let frameCount   = 0;

        const loop = () => {
          frameCount++;
          ctx.clearRect(0, 0, W, H);

          if (frameCount % this.SNAP_EVERY === 0) {
            for (let i = 0; i < sliceCount; i++) {
              if (Math.random() < this.DENSITY)
                offsetsX[i] = (Math.random() - 0.5) * this.MAX_OFFSET * 2;
              if (Math.random() < this.WRAP_CHANCE)
                offsetsY[i] = (Math.random() - 0.5) * H * this.WRAP_RANGE * 2;
              else if (Math.random() < 0.15)
                offsetsY[i] = 0;
            }
          }

          for (let i = 0; i < sliceCount; i++) {
            const y  = i * this.SLICE_H;
            const sh = Math.min(this.SLICE_H, H - y);
            if (sh <= 0) continue;
            ctx.drawImage(src, 0, y * dpr, W * dpr, sh * dpr, offsetsX[i], y + offsetsY[i], W, sh);
          }

          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        // Fisher-Yates shuffle the reveal order
        const order = charSpans.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }

        const waveHold = el.dataset.waveHold !== undefined ? Number(el.dataset.waveHold) : this.WAVE_HOLD;
        const stepDur  = el.dataset.stepDur  !== undefined ? Number(el.dataset.stepDur)  : this.STEP_DUR;

        inst.timeouts = order.map((ci, step) =>
          setTimeout(() => {
            charSpans[ci].style.zIndex  = "3";
            charSpans[ci].style.opacity = "1";
          }, waveHold + step * stepDur)
        );

        inst.timeouts.push(setTimeout(() => {
          cancelAnimationFrame(inst.animId); inst.animId = null;
          canvas.style.opacity = "0";
        }, waveHold + charSpans.length * stepDur + 50));
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        (inst.timeouts || []).forEach(clearTimeout); inst.timeouts = [];
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.canvas.style.opacity = "0";
        inst.charSpans.forEach(s => { s.style.opacity = "1"; s.style.zIndex = "1"; });
      }
    }

    new ScanlineTextReveal();

    // ------------------------------------------------------------------------------

    class FisherYatesScanline {
      constructor() {
        this.SLICE_H        = 2;    // px height of each horizontal strip
        this.MAX_OFFSET     = 3;    // px max horizontal displacement
        this.SNAP_EVERY     = 2;    // rAF frames between offset updates
        this.DENSITY        = 0.05; // fraction of strips displaced
        this.WRAP_CHANCE    = 0.01; // probability of vertical jump per strip
        this.WRAP_RANGE     = 0.6;  // max vertical jump as fraction of height
        this.SCRAMBLE_STEPS = 4;    // full-scramble passes before reveal
        this.STEP_DURATION  = 0.04; // seconds per Fisher-Yates step
        this.instances      = new Map();
        this.init();
      }

      init() {
        document.querySelectorAll("[data-fy-scanline]").forEach(el => {
          const text = el.textContent.trim();
          el.innerHTML = "";
          el.setAttribute("aria-label", text);

          // Wrap text in a span so Fisher-Yates can update it without destroying the canvas
          const textSpan = document.createElement("span");
          textSpan.textContent = text;
          el.appendChild(textSpan);

          const canvas = document.createElement("canvas");
          canvas.className = "sdw-canvas";
          canvas.style.opacity = "0";
          el.appendChild(canvas);

          el.addEventListener("mouseenter", () => this._onEnter(el));
          el.addEventListener("mouseleave", () => this._onLeave(el));
          this.instances.set(el, { textSpan, canvas, animId: null, tl: null });
        });
      }

      _onEnter(el) {
        this._onLeave(el);
        const inst           = this.instances.get(el);
        const { textSpan, canvas } = inst;
        const style          = getComputedStyle(el);
        const dpr            = window.devicePixelRatio || 1;
        const W              = el.offsetWidth;
        const H              = el.offsetHeight;
        const originalText   = el.getAttribute("aria-label");
        const origColor      = style.color;
        const font           = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

        // Visible overlay canvas
        canvas.width         = Math.round(W * dpr);
        canvas.height        = Math.round(H * dpr);
        canvas.style.width   = W + "px";
        canvas.style.height  = H + "px";
        canvas.style.opacity = "1";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        // Offscreen canvas — re-rendered each frame from textSpan's current content
        const src  = document.createElement("canvas");
        src.width  = Math.round(W * dpr);
        src.height = Math.round(H * dpr);
        const sctx = src.getContext("2d");
        sctx.scale(dpr, dpr);
        sctx.font         = font;
        sctx.fillStyle    = origColor;
        sctx.textBaseline = "alphabetic";
        const m = sctx.measureText(originalText);
        const baselineY = (H + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;

        // Hide text span — canvas is the only visible layer
        textSpan.style.visibility = "hidden";

        const sliceCount = Math.ceil(H / this.SLICE_H);
        const offsetsX   = new Float32Array(sliceCount);
        const offsetsY   = new Float32Array(sliceCount);
        let frameCount   = 0;

        const loop = () => {
          frameCount++;

          // Read current scrambled text from the span (safe — Fisher-Yates only updates textSpan)
          sctx.clearRect(0, 0, W, H);
          sctx.fillText(textSpan.textContent, 0, baselineY);

          ctx.clearRect(0, 0, W, H);

          if (frameCount % this.SNAP_EVERY === 0) {
            for (let i = 0; i < sliceCount; i++) {
              if (Math.random() < this.DENSITY)
                offsetsX[i] = (Math.random() - 0.5) * this.MAX_OFFSET * 2;
              if (Math.random() < this.WRAP_CHANCE)
                offsetsY[i] = (Math.random() - 0.5) * H * this.WRAP_RANGE * 2;
              else if (Math.random() < 0.15)
                offsetsY[i] = 0;
            }
          }

          for (let i = 0; i < sliceCount; i++) {
            const y  = i * this.SLICE_H;
            const sh = Math.min(this.SLICE_H, H - y);
            if (sh <= 0) continue;
            ctx.drawImage(src, 0, y * dpr, W * dpr, sh * dpr, offsetsX[i], y + offsetsY[i], W, sh);
          }

          inst.animId = requestAnimationFrame(loop);
        };
        loop();

        // Fisher-Yates scramble via GSAP timeline
        const originalChars = getChars(originalText);
        const nonSpaceCount = originalChars.filter(c => c !== " ").length;
        const S = this.STEP_DURATION;
        const N = this.SCRAMBLE_STEPS;

        // Custom scramble that writes to textSpan instead of el
        // (using el.innerText would destroy the canvas child element)
        const scramble = (revealedCount) => {
          const result = [...originalChars];
          const unrevealedIdx = [];
          let locked = 0;
          for (let i = 0; i < result.length; i++) {
            if (result[i] === " ") continue;
            if (locked < revealedCount) { locked++; }
            else { unrevealedIdx.push(i); }
          }
          const shuffled = fyFn(unrevealedIdx.map(i => result[i]));
          unrevealedIdx.forEach((idx, i) => result[idx] = shuffled[i]);
          textSpan.textContent = result.join("");
        };

        const tl = gsap.timeline({
          onComplete: () => {
            textSpan.textContent = originalText;
            textSpan.style.visibility = "";
            cancelAnimationFrame(inst.animId); inst.animId = null;
            canvas.style.opacity = "0";
          }
        });

        for (let s = 0; s < N; s++)
          tl.add(() => scramble(0), S * s);
        for (let r = 1; r <= nonSpaceCount; r++)
          tl.add(() => scramble(r), S * (N + r - 1));

        inst.tl = tl;
      }

      _onLeave(el) {
        const inst = this.instances.get(el);
        if (!inst) return;
        if (inst.tl)     { inst.tl.kill(); inst.tl = null; }
        if (inst.animId) { cancelAnimationFrame(inst.animId); inst.animId = null; }
        inst.canvas.style.opacity = "0";
        inst.textSpan.textContent  = el.getAttribute("aria-label");
        inst.textSpan.style.visibility = "";
      }
    }

    new FisherYatesScanline();

    // ------------------------------------------------------------------------------

    // ------------------------------------------------------------------------------

    function applyFilter(filter) {
      document.querySelectorAll(".container > div").forEach(row => {
        const isFavorite = !!row.querySelector(".selected-badge");
        const visible =
          filter === "all"         ||
          filter === "favorite"    && isFavorite ||
          filter === "experiments" && !isFavorite;
        row.style.display = visible ? "" : "none";
      });
    }

    document.querySelectorAll(".filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        applyFilter(btn.dataset.filter);
      });
    });

    // Apply the default active filter on load
    const defaultBtn = document.querySelector(".filter-btn.active");
    if (defaultBtn) applyFilter(defaultBtn.dataset.filter);

