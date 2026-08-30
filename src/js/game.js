/**
 * game.js — the round, start to finish.
 *
 * Four steps, one big button at a time:
 *   1. record a phrase          2. hear it backwards
 *   3. record the backwards bit 4. hear that backwards, and get marked
 *
 * Completed steps stay on screen with their waveform so you can replay any of
 * them and watch the shape flip. All player-facing wording comes from copy.js —
 * nothing user-visible is written inline here.
 */

import { AudioEngine, AudioError, encodeWav, environmentProblem } from './audio.js';
import { Waveform } from './viz.js';
import { scoreAttempt } from './dsp.js';
import { burst } from './confetti.js';
import { makeSfx } from './sfx.js';
import { COPY } from './copy.js';

const MAX_RECORD_SECONDS = 8;
const SLOW_RATE = 0.7;
const STORE_KEY = 'sdrawkcab:v1';

const STEP_KIND = ['record', 'play', 'record', 'play'];

/** localStorage, but it never takes the app down with it. */
const store = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  },
  write(value) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

export class Game {
  constructor() {
    this.engine = new AudioEngine();
    this.sfx = makeSfx(this.engine);
    this.step = 1;
    this.takes = { original: null, mimic: null };
    this.reversed = { original: null, mimic: null };
    this.result = null;
    this.resultShown = false;
    this.waves = {};
    this.busy = false;
    this.el = {};
    this.stats = store.read();
    this._timer = null;
  }

  /* ---------------- setup ---------------- */

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      steps: $('steps'),
      tagline: $('tagline'),
      result: $('result'),
      resultKicker: $('result-kicker'),
      scoreFill: $('score-fill'),
      scoreNumber: $('score-number'),
      resultTitle: $('result-title'),
      resultQuip: $('result-quip'),
      compareWave: $('compare-wave'),
      againBtn: $('again-btn'),
      shareBtn: $('share-btn'),
      streak: $('streak'),
      toast: $('toast'),
      confetti: $('confetti'),
      helpBtn: $('help-btn'),
      helpSheet: $('help-sheet'),
      helpClose: $('help-close'),
      howList: $('how-list'),
      blockerSheet: $('blocker-sheet'),
      blockerTitle: $('blocker-title'),
      blockerBody: $('blocker-body'),
      blockerClose: $('blocker-close'),
    };

    this.el.tagline.textContent = COPY.tagline;
    this.el.againBtn.textContent = COPY.microcopy.goAgain;
    this.el.shareBtn.textContent = COPY.microcopy.shareButton;
    this.el.howList.innerHTML = '';
    for (const line of COPY.microcopy.howToPlay) {
      const li = document.createElement('li');
      li.innerHTML = line;
      this.el.howList.appendChild(li);
    }

    this.renderSteps();
    this.compareWave = new Waveform(this.el.compareWave);
    this.compareWave.setColors({
      bar: cssVar('--accent'),
      played: cssVar('--accent'),
      ghost: cssVar('--ghost'),
    });

    this.el.helpBtn.addEventListener('click', () => this.el.helpSheet.showModal());
    this.el.helpClose.addEventListener('click', () => this.el.helpSheet.close());
    this.el.blockerClose.addEventListener('click', () => this.el.blockerSheet.close());
    this.el.againBtn.addEventListener('click', () => this.reset());
    this.el.shareBtn.addEventListener('click', () => this.share());

    // A take is a lie if the tab was backgrounded, so the engine drops it — we
    // just have to put the UI back into a sane state.
    this.engine.onInterrupted = () => {
      if (this.busy) this.recover(COPY.microcopy.interrupted);
    };

    const problem = environmentProblem();
    if (problem) this.showBlocker(problem);

    this.updateStreak();
    this.setStep(1);
  }

  renderSteps() {
    this.el.steps.innerHTML = '';
    COPY.steps.forEach((step, index) => {
      const n = index + 1;
      const li = document.createElement('li');
      li.className = 'step';
      li.dataset.step = String(n);
      li.dataset.state = 'locked';
      li.innerHTML = `
        <div class="step-head">
          <span class="step-num" aria-hidden="true">${n}</span>
          <h2 class="step-title">${escapeHtml(step.stepName)}</h2>
        </div>
        <p class="step-help">${escapeHtml(step.helperText)}</p>
        <div class="wave-box">
          <canvas aria-label="Waveform for step ${n}"></canvas>
          <span class="wave-timer" hidden></span>
        </div>
        <button type="button" class="btn ${n % 2 ? 'btn-primary' : 'btn-secondary'} step-primary"></button>
        <div class="step-extras"></div>`;
      this.el.steps.appendChild(li);

      const primary = li.querySelector('.step-primary');
      primary.textContent = step.buttonLabel;
      primary.addEventListener('click', () => this.onPrimary(n));

      this.waves[n] = new Waveform(li.querySelector('canvas'));
      this.waves[n].setColors({
        bar: n % 2 ? cssVar('--accent') : cssVar('--accent-2'),
        played: cssVar('--ink'),
      });

      if (n === 1) this.mountPhrasePicker(li);
    });
  }

  /** Step 1 gets a suggested phrase, because "think of something" is a stall. */
  mountPhrasePicker(li) {
    const wrap = document.createElement('div');
    wrap.className = 'phrase-picker';
    wrap.innerHTML = `
      <span class="phrase-label">${escapeHtml(COPY.microcopy.phraseLabel)}</span>
      <strong class="phrase-word" id="phrase-word"></strong>
      <button type="button" class="phrase-shuffle" aria-label="Suggest another phrase">&#8635;</button>`;
    li.querySelector('.step-help').after(wrap);
    this.el.phraseWord = wrap.querySelector('.phrase-word');
    wrap.querySelector('.phrase-shuffle').addEventListener('click', () => this.shufflePhrase());
    this.shufflePhrase();
  }

  shufflePhrase() {
    const list = COPY.promptPhrases;
    let next = this.el.phraseWord.textContent;
    // Never show the same suggestion twice in a row — it reads as a broken button.
    while (list.length > 1 && next === this.el.phraseWord.textContent) {
      next = list[Math.floor(Math.random() * list.length)];
    }
    this.el.phraseWord.textContent = next;
  }

  /* ---------------- step state ---------------- */

  stepEl(n) { return this.el.steps.querySelector(`[data-step="${n}"]`); }

  setStep(n) {
    this.step = n;
    for (let i = 1; i <= 4; i++) {
      const el = this.stepEl(i);
      const state = i < n ? 'done' : i === n ? 'active' : 'locked';
      el.dataset.state = state;
      const primary = el.querySelector('.step-primary');
      primary.disabled = state === 'locked' || this.busy;
      primary.textContent = state === 'done'
        ? COPY.steps[i - 1].buttonLabelDone
        : COPY.steps[i - 1].buttonLabel;
    }
    const active = this.stepEl(n);
    if (active && n > 1) {
      active.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    }
    this.renderExtras();
  }

  /** Secondary actions, rebuilt whenever the step changes. */
  renderExtras() {
    for (let i = 1; i <= 4; i++) {
      const host = this.stepEl(i).querySelector('.step-extras');
      host.innerHTML = '';
      const add = (label, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost';
        b.textContent = label;
        b.disabled = this.busy;
        b.addEventListener('click', onClick);
        host.appendChild(b);
        return b;
      };

      if (i === 1 && this.takes.original) {
        add(COPY.microcopy.redo, () => this.redoFrom(1));
      }
      if (i === 2 && this.reversed.original) {
        add(COPY.microcopy.slower, () => this.playBuffer(2, this.reversed.original, { rate: SLOW_RATE }));
      }
      if (i === 3 && this.takes.mimic) {
        add(COPY.microcopy.redo, () => this.redoFrom(3));
      }
      if (i === 4 && this.reversed.mimic) {
        add(COPY.microcopy.playForward, () => this.playBuffer(4, this.takes.mimic.buffer));
      }
    }
  }

  /* ---------------- actions ---------------- */

  async onPrimary(n) {
    // `busy` is not set until doRecord/playBuffer runs, which is several awaits
    // away — so two quick taps would both clear a `busy` check and race into
    // getUserMedia together, orphaning a microphone stream. This flag closes
    // that window synchronously, before the first await.
    if (this.busy || this._entering) return;
    this._entering = true;
    try {
      await this._runPrimary(n);
    } finally {
      this._entering = false;
    }
  }

  async _runPrimary(n) {
    // The first tap anywhere is what buys us a running AudioContext; iOS will
    // not start one outside a gesture, and will happily report "running" while
    // playing nothing if it was never primed.
    try { await this.engine.unlock(); } catch { /* handled below on use */ }

    const kind = STEP_KIND[n - 1];
    const done = this.stepEl(n).dataset.state === 'done';

    if (kind === 'record') {
      // A finished recording step plays the take back. Re-recording is the
      // explicit "Redo this bit" button, so a stray tap can never wipe a good take.
      if (done) {
        const take = this.takes[n === 1 ? 'original' : 'mimic'];
        if (take) await this.playBuffer(n, take.buffer);
        return;
      }
      await this.doRecord(n);
      return;
    }
    await this.doPlay(n);
  }

  async doRecord(n) {
    const el = this.stepEl(n);
    const primary = el.querySelector('.step-primary');
    const wave = this.waves[n];
    const timer = el.querySelector('.wave-timer');
    const copy = COPY.steps[n - 1];

    this.setBusy(true);
    primary.disabled = false;
    primary.textContent = COPY.microcopy.warmingUp;

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      this.engine.stopRecording();
    };

    this.engine.onLevel = (peak) => wave.pushLevel(Math.min(1, peak * 1.7));

    try {
      const startedAt = { t: 0 };
      const take = await this.engine.record({
        maxSeconds: MAX_RECORD_SECONDS,
        onStart: () => {
          startedAt.t = performance.now();
          el.classList.add('is-recording');
          primary.classList.add('is-live');
          primary.textContent = copy.buttonLabelActive;
          timer.hidden = false;
          wave.startLive();
          this.sfx.recordStart();
          primary.addEventListener('click', stop, { once: true });
          this._timer = setInterval(() => {
            const secs = (performance.now() - startedAt.t) / 1000;
            timer.textContent = `${secs.toFixed(1)}s`;
            if (secs >= MAX_RECORD_SECONDS) stop();
          }, 100);
        },
      });
      this.finishRecording(n, take);
    } catch (err) {
      this.handleError(err);
      this.resetStepUi(n);
    } finally {
      clearInterval(this._timer);
      this._timer = null;
      this.engine.onLevel = null;
      // Release on every path, not just the successful one. A failed or
      // interrupted take used to leave the track open, so the OS recording
      // indicator stayed lit while the game sat idle — which reasonably reads
      // as "this thing is still listening to me".
      this.engine.releaseMic();
      el.classList.remove('is-recording');
      primary.classList.remove('is-live');
      timer.hidden = true;
      wave.stopLive();
      this.setBusy(false);
    }
  }

  finishRecording(n, take) {
    this.sfx.recordStop();
    const slot = n === 1 ? 'original' : 'mimic';
    this.takes[slot] = take;
    this.reversed[slot] = take.reversed(this.engine.ctx);

    // Show the take you just made, then the reversed version on the next step —
    // seeing the same shape flip is what makes the trick land.
    this.waves[n].setBuffer(take.buffer);
    this.waves[n + 1].setBuffer(this.reversed[slot], { mirrored: false });

    // The mic is only needed for the recording steps; holding it open would
    // leave the OS recording dot lit through playback and scoring.
    this.engine.releaseMic();

    this.toast(COPY.steps[n - 1].doneToast);
    this.sfx.advance();
    if (n === 3) this.computeScore();
    this.setStep(n + 1);
  }

  async doPlay(n) {
    const buffer = n === 2 ? this.reversed.original : this.reversed.mimic;
    if (!buffer) return;
    await this.playBuffer(n, buffer);

    if (n === 2) {
      // Listening once is what unlocks the imitation step.
      if (this.step === 2) this.setStep(3);
    } else if (n === 4 && !this.resultShown) {
      this.showResult();
    }
  }

  /**
   * On iOS the physical ring/silent switch mutes Web Audio unless the page can
   * claim a playback audio session — and that API only exists on 16.4+. Where
   * we cannot claim it, say so once rather than leaving someone tapping a
   * button that appears to do nothing.
   */
  maybeWarnAboutSilentSwitch() {
    if (this._warnedSilent) return;
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!iOS || navigator.audioSession) return;
    this._warnedSilent = true;
    this.toast(COPY.microcopy.silentSwitch);
  }

  /** Plays a buffer through one step's waveform, animating the playhead. */
  async playBuffer(n, buffer, { rate = 1 } = {}) {
    if (this.busy) return;
    this.maybeWarnAboutSilentSwitch();
    this.setBusy(true);
    const el = this.stepEl(n);
    const primary = el.querySelector('.step-primary');
    const label = primary.textContent;
    const wave = this.waves[n];
    primary.textContent = COPY.microcopy.playing;

    const duration = buffer.duration / rate;
    const start = performance.now();
    let raf = 0;
    const animate = () => {
      const p = (performance.now() - start) / 1000 / duration;
      wave.setProgress(Math.min(1, p));
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    try {
      await this.engine.play(buffer, { rate });
    } catch (err) {
      this.handleError(err);
    } finally {
      cancelAnimationFrame(raf);
      wave.setProgress(0);
      primary.textContent = label;
      this.setBusy(false);
    }
  }

  /* ---------------- scoring + result ---------------- */

  computeScore() {
    try {
      this.result = scoreAttempt(this.takes.original.buffer, this.reversed.mimic);
    } catch {
      this.result = null;
    }
  }

  showResult() {
    if (!this.result) return;
    const { score, reason } = this.result;
    if (reason) {
      this.toast(COPY.microcopy.tooQuiet);
      return;
    }

    this.resultShown = true;
    const tier = [...COPY.scoreTiers].reverse().find((t) => score >= t.minScore) || COPY.scoreTiers[0];
    this.el.resultKicker.textContent = COPY.microcopy.resultKicker;
    this.el.resultTitle.textContent = tier.title;
    this.el.resultQuip.textContent = tier.quip;
    this.el.result.hidden = false;

    this.compareWave.setGhost(this.takes.original.buffer);
    this.compareWave.setBuffer(this.reversed.mimic);

    // Count up rather than snapping: the number is the payoff of the round.
    const CIRCUMFERENCE = 327;
    this.el.scoreFill.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - score / 100));
    this.el.scoreFill.style.stroke = score >= 80 ? cssVar('--success')
      : score >= 55 ? cssVar('--warn') : cssVar('--accent');
    this.countTo(score);

    this.sfx.reveal();
    if (score >= 80) burst(this.el.confetti);
    // A human cannot land this close by mouth alone — somebody held the phone
    // up to the speaker. Worth a nudge, not an accusation.
    if (this.result.suspicious) this.toast(COPY.microcopy.suspicious);

    const best = Math.max(this.stats.best || 0, score);
    this.stats = { ...this.stats, best, rounds: (this.stats.rounds || 0) + 1, last: score };
    store.write(this.stats);
    this.updateStreak();

    this.el.result.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  }

  countTo(score) {
    const node = this.el.scoreNumber;
    if (prefersReducedMotion()) { node.textContent = String(score); return; }
    const start = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / 1100);
      // Ease out so it decelerates into the final number.
      node.textContent = String(Math.round(score * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  updateStreak() {
    const { best, rounds } = this.stats;
    this.el.streak.textContent = rounds
      ? COPY.microcopy.streak
        .replace('{best}', best)
        .replace('{rounds}', rounds)
        .replace('{s}', rounds === 1 ? '' : 's')
      : '';
  }

  /* ---------------- sharing ---------------- */

  async share() {
    if (!this.reversed.mimic) return;
    const blob = encodeWav(this.reversed.mimic);
    const file = new File([blob], 'sdrawkcab.wav', { type: 'audio/wav' });
    const text = COPY.microcopy.shareText.replace('{score}', this.result ? this.result.score : '');

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: COPY.appName });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the player closed the sheet
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sdrawkcab.wav';
    a.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this.toast(COPY.microcopy.downloaded);
  }

  /* ---------------- flow control ---------------- */

  redoFrom(n) {
    if (this.busy) return;
    if (n === 1) {
      this.takes = { original: null, mimic: null };
      this.reversed = { original: null, mimic: null };
      for (let i = 1; i <= 4; i++) this.waves[i].setBuffer(null);
    } else {
      this.takes.mimic = null;
      this.reversed.mimic = null;
      this.waves[3].setBuffer(null);
      this.waves[4].setBuffer(null);
    }
    this.result = null;
    this.resultShown = false;
    this.el.result.hidden = true;
    this.setStep(n);
  }

  reset() {
    this.redoFrom(1);
    this.shufflePhrase();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  resetStepUi(n) {
    const primary = this.stepEl(n).querySelector('.step-primary');
    primary.textContent = COPY.steps[n - 1].buttonLabel;
    this.waves[n].setBuffer(this.takes[n === 1 ? 'original' : 'mimic']?.buffer || null);
  }

  recover(message) {
    this.engine.releaseMic();
    this.setBusy(false);
    this.toast(message);
  }

  setBusy(value) {
    this.busy = value;
    for (let i = 1; i <= 4; i++) {
      const el = this.stepEl(i);
      const primary = el.querySelector('.step-primary');
      const locked = el.dataset.state === 'locked';
      primary.disabled = locked || (value && i !== this.step);
      el.querySelectorAll('.step-extras .btn').forEach((b) => { b.disabled = value; });
    }
    // These were left enabled while audio played, so "Go again" would scroll
    // and reshuffle the phrase but quietly decline to reset anything.
    this.el.againBtn.disabled = value;
    this.el.shareBtn.disabled = value;
  }

  /* ---------------- messaging ---------------- */

  handleError(err) {
    this.sfx.error();
    const code = err instanceof AudioError ? err.code : 'unknown';
    if (code === 'cancelled') return;
    if (code === 'denied' || code === 'insecure' || code === 'unsupported' || code === 'no-mic') {
      this.showBlocker(code);
      return;
    }
    this.toast(COPY.microcopy.errors[code] || COPY.microcopy.errors.unknown);
  }

  showBlocker(code) {
    const info = COPY.blockers[code] || COPY.blockers.unknown;
    this.el.blockerTitle.textContent = info.title;
    this.el.blockerBody.textContent = info.body;
    if (!this.el.blockerSheet.open) this.el.blockerSheet.showModal();
  }

  toast(message) {
    if (!message) return;
    const el = this.el.toast;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
}

/* ---------------- helpers ---------------- */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
