/**
 * audio.js — microphone in, reversed audio out.
 *
 * The design rule everything here follows: the take is raw PCM, start to
 * finish. No codec ever touches it. That matters more than it sounds — every
 * lossy encoder bolts priming silence onto the front of a file (AAC ~1024-2112
 * samples, Opus a 6.5 ms pre-skip), and browsers disagree about trimming it
 * back off. In a normal recorder that is invisible. In a game built on
 * reverse(reverse(x)) === x it becomes a different amount of trailing silence
 * on each take, which lands straight in the score. So: AudioWorklet capture,
 * Float32 all the way, and the identity holds sample for sample.
 */

import { trimSilence, ANALYSIS_RATE } from './dsp.js';

export const MAX_TAKE_SECONDS = 10;
const MIN_TAKE_SECONDS = 0.35;
const WARMUP_MS = 250;      // mics ramp; capturing immediately clips your first syllable
const SILENCE_PEAK = 0.008; // below this the take is "we didn't hear anything"

/** Thrown for problems we have something friendly to say about. */
export class AudioError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioError';
    this.code = code;
  }
}

/** Maps a getUserMedia rejection onto one of our own codes. */
function classifyMicError(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new AudioError('denied', 'Microphone permission was denied.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new AudioError('no-mic', 'No microphone was found.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new AudioError('busy', 'The microphone is already in use by another app.');
    case 'SecurityError':
      return new AudioError('insecure', 'Microphone access needs a secure (https) connection.');
    case 'AbortError':
      return new AudioError('aborted', 'The microphone was interrupted.');
    default:
      return new AudioError('unknown', (err && err.message) || 'The microphone failed.');
  }
}

/** True in contexts that cannot record — file://, and most in-app webviews. */
export function environmentProblem() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unsupported';
  return null;
}

/**
 * A finished recording. Immutable: nothing in the app mutates an AudioBuffer
 * after it is built, because getChannelData() hands back a live reference and
 * one stray .reverse() would silently destroy the original take.
 */
export class Take {
  constructor(buffer) {
    this.buffer = buffer;
    this.sampleRate = buffer.sampleRate;
    this.duration = buffer.duration;
    this._reversed = null;
  }

  /** The same audio, backwards. Built once, then cached. */
  reversed(ctx) {
    if (!this._reversed) this._reversed = reverseBuffer(ctx, this.buffer);
    return this._reversed;
  }
}

/** Allocates a NEW buffer holding `buffer` backwards. Never mutates the input. */
export function reverseBuffer(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const scratch = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    buffer.copyFromChannel(scratch, c);
    const target = out.getChannelData(c);
    for (let i = 0, j = buffer.length - 1; i < buffer.length; i++, j--) target[i] = scratch[j];
  }
  return out;
}

/** Encodes an AudioBuffer as a 16-bit PCM WAV blob, for download and sharing. */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.sink = null;
    this.processor = null;   // ScriptProcessor fallback, if we ever need it
    this.playing = null;
    this._recording = null;
    this.onLevel = null;
    this.onInterrupted = null;
    this._bindLifecycle();
  }

  /* ---- context ---- */

  /**
   * Must be called from inside a real user gesture. Creates the one long-lived
   * AudioContext, resumes it, and primes it with a silent buffer — on iOS an
   * unprimed context will happily report "running" and play nothing.
   */
  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new AudioError('unsupported', 'This browser has no Web Audio support.');
      // Deliberately no sampleRate option: forcing one inserts a resampler
      // between the hardware and the graph on iOS, which crackles.
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx.onstatechange = () => {
        // iOS adds a non-standard 'interrupted' state (a call, Siri, the alarm).
        if (this.ctx.state !== 'running' && this.onInterrupted) this.onInterrupted(this.ctx.state);
      };
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* a later gesture will retry */ }
    }
    const silent = this.ctx.createBufferSource();
    silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    silent.connect(this.ctx.destination);
    silent.start(0);
    return this.ctx.state === 'running';
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /* ---- microphone ---- */

  async acquireMic() {
    if (this.stream) return this.stream;
    const problem = environmentProblem();
    if (problem) throw new AudioError(problem, 'Recording is not available here.');

    // Plain booleans, not { exact: false }: exact makes gUM reject outright on
    // hardware that cannot comply, and a processed take beats no take.
    //
    // All three are off on purpose. Noise suppression is the dangerous one —
    // reversed speech is precisely what an NS model decides is not speech, and
    // it will gate a whole quiet take down to digital silence. Echo
    // cancellation matters too: in step 3 you are imitating a sound this phone
    // just played, and EC would carve pieces out of your imitation.
    const ideal = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(ideal);
    } catch (err) {
      if (err && err.name === 'OverconstrainedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (retryErr) {
          throw classifyMicError(retryErr);
        }
      } else {
        throw classifyMicError(err);
      }
    }

    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      // The OS or the user can yank the device out from under us at any time.
      track.onended = () => this._abortRecording('device-lost');
      track.onmute = () => this._abortRecording('interrupted');
    }
    await this._buildGraph();
    return stream;
  }

  /**
   * Tears the microphone down. Disconnecting nodes is not enough — only
   * track.stop() turns the OS recording indicator off, and players reasonably
   * assume a lit mic dot means the game is still listening.
   */
  releaseMic() {
    this._abortRecording('released');
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        t.onended = null;
        t.onmute = null;
        t.stop();
      });
      this.stream = null;
    }
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.worklet) {
      try { this.worklet.port.postMessage({ type: 'disarm' }); } catch { /* already gone */ }
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.sink) { this.sink.disconnect(); this.sink = null; }
    // The AudioContext itself stays alive on purpose: iOS is slow to open new
    // ones and has a small cap on how many can exist.
  }

  async _buildGraph() {
    const ctx = this.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);

    // Everything terminates in a muted sink. Some engines will not pull a node
    // that reaches no destination (ScriptProcessor flatly refuses to fire), and
    // with echo cancellation off, any audible monitoring path is a feedback
    // howl on a phone lying on a table.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);

    const loaded = await this._loadWorklet();
    if (loaded) {
      this.worklet = new AudioWorkletNode(ctx, 'take-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      this.worklet.port.onmessage = (e) => this._onAudioPacket(e.data);
      this.source.connect(this.worklet);
      this.worklet.connect(this.sink);
      return;
    }

    // Last resort for locked-down webviews. Deprecated, noisy in the console,
    // and works everywhere.
    this.processor = ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        const a = Math.abs(input[i]);
        if (a > peak) peak = a;
        sum += input[i] * input[i];
      }
      this._onAudioPacket({ type: 'level', peak, rms: Math.sqrt(sum / input.length) });
      if (this._recording && this._recording.armed) {
        this._onAudioPacket({ type: 'samples', samples: input.slice(0) });
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
  }

  async _loadWorklet() {
    const ctx = this.ctx;
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') return false;
    if (AudioEngine._workletLoaded.has(ctx)) return true;
    const url = new URL('../audio/take-capture.worklet.js', import.meta.url).href;
    try {
      await ctx.audioWorklet.addModule(url);
      AudioEngine._workletLoaded.add(ctx);
      return true;
    } catch {
      return false;
    }
  }

  /* ---- recording ---- */

  _onAudioPacket(data) {
    if (!data) return;
    if (data.type === 'level') {
      if (this.onLevel) this.onLevel(data.peak, data.rms);
      return;
    }
    if (data.type === 'samples' && this._recording && this._recording.armed) {
      const rec = this._recording;
      rec.chunks.push(data.samples);
      rec.frames += data.samples.length;
      if (rec.frames >= rec.maxFrames) this.stopRecording();
    }
  }

  /**
   * Records until stopRecording() is called, the cap is reached, or something
   * interrupts. Resolves with a Take, or rejects with an AudioError.
   *
   * @param {{maxSeconds?: number, onStart?: Function}} options
   */
  async record({ maxSeconds = MAX_TAKE_SECONDS, onStart } = {}) {
    if (this._recording) throw new AudioError('busy', 'Already recording.');
    if (!this.ready) await this.unlock();
    await this.acquireMic();

    const ctx = this.ctx;
    const rec = {
      chunks: [],
      frames: 0,
      armed: false,
      maxFrames: Math.floor(maxSeconds * ctx.sampleRate),
      sampleRate: ctx.sampleRate,
      resolve: null,
      reject: null,
    };
    this._recording = rec;
    const done = new Promise((resolve, reject) => { rec.resolve = resolve; rec.reject = reject; });

    // Let the mic ramp before we start keeping samples, otherwise the opening
    // syllable arrives hollow — and on the reversed clip that is the *ending*,
    // which is the punchline.
    await new Promise((r) => setTimeout(r, WARMUP_MS));
    if (this._recording !== rec) return done; // aborted during warm-up

    rec.armed = true;
    if (this.worklet) this.worklet.port.postMessage({ type: 'arm' });
    if (onStart) onStart();
    return done;
  }

  /** Ends the current take and resolves the record() promise. */
  stopRecording() {
    const rec = this._recording;
    if (!rec || !rec.armed) return;
    rec.armed = false;
    this._recording = null;
    if (this.worklet) this.worklet.port.postMessage({ type: 'disarm' });

    let merged = new Float32Array(rec.frames);
    let offset = 0;
    for (const chunk of rec.chunks) { merged.set(chunk, offset); offset += chunk.length; }
    rec.chunks.length = 0;

    if (merged.length < MIN_TAKE_SECONDS * rec.sampleRate) {
      rec.reject(new AudioError('too-short', 'That was over before it began.'));
      return;
    }

    let peak = 0;
    for (let i = 0; i < merged.length; i++) {
      const a = Math.abs(merged[i]);
      if (a > peak) peak = a;
    }
    if (peak < SILENCE_PEAK) {
      rec.reject(new AudioError('silent', "We didn't hear anything."));
      return;
    }

    // Trim once, here, so that every downstream consumer — playback, scoring,
    // the waveform, the WAV export — sees the same audio. Trimming only at
    // scoring time would mean the clip you hear and the clip you are marked on
    // are different clips.
    merged = trimForTake(merged, rec.sampleRate);

    const buffer = this.ctx.createBuffer(1, merged.length, rec.sampleRate);
    buffer.copyToChannel(merged, 0);
    rec.resolve(new Take(buffer));
  }

  _abortRecording(reason) {
    const rec = this._recording;
    if (!rec) return;
    rec.armed = false;
    this._recording = null;
    rec.chunks.length = 0;
    if (this.worklet) {
      try { this.worklet.port.postMessage({ type: 'disarm' }); } catch { /* gone */ }
    }
    rec.reject(new AudioError(reason === 'released' ? 'cancelled' : 'interrupted',
      'Something interrupted that take.'));
  }

  get isRecording() {
    return !!(this._recording && this._recording.armed);
  }

  /* ---- playback ---- */

  /**
   * Plays a buffer. Every press builds a fresh source node, because an
   * AudioBufferSourceNode is single-use — reusing one throws InvalidStateError.
   *
   * @param {AudioBuffer} buffer
   * @param {{onEnded?: Function, rate?: number}} options
   * @returns {Promise<void>} resolves when playback finishes or is stopped
   */
  async play(buffer, { onEnded, rate = 1 } = {}) {
    if (!this.ready) await this.unlock();
    this.stopPlayback();

    const source = this.ctx.createBufferSource();
    source.buffer = await this._matchRate(buffer);
    // Slowing playback is a real help: reversed speech is much easier to copy
    // at 70% speed, and it keeps a hard round from becoming a dead end.
    source.playbackRate.value = rate;
    source.connect(this.ctx.destination);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        // onended also fires for an explicit stop(), so this must be idempotent.
        if (settled) return;
        settled = true;
        source.onended = null;
        source.disconnect();
        if (this.playing === source) this.playing = null;
        if (onEnded) onEnded();
        resolve();
      };
      source.onended = finish;
      this.playing = source;
      source.start(0);
    });
  }

  stopPlayback() {
    const source = this.playing;
    if (!source) return;
    this.playing = null;
    try { source.stop(); } catch { /* never started, or already stopped */ }
  }

  get isPlaying() {
    return !!this.playing;
  }

  /**
   * Guards against an iOS route change (pairing AirPods mid-round drops the
   * context from 48 kHz to 24 kHz). Playing a 48 kHz take through a 24 kHz
   * context makes it slow and demonic — funny, but the wrong funny, and it
   * would wreck the score.
   */
  async _matchRate(buffer) {
    if (buffer.sampleRate === this.ctx.sampleRate) return buffer;
    const frames = Math.ceil((buffer.length * this.ctx.sampleRate) / buffer.sampleRate);
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) return buffer;
    const offline = new OfflineCtor(buffer.numberOfChannels, frames, this.ctx.sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0);
    return offline.startRendering();
  }

  /* ---- lifecycle ---- */

  _bindLifecycle() {
    const drop = () => {
      this._abortRecording('interrupted');
      this.stopPlayback();
      this.releaseMic();
    };
    document.addEventListener('visibilitychange', () => {
      // A backgrounded tab suspends the context; samples collected there are a lie.
      if (document.visibilityState === 'hidden') drop();
    });
    window.addEventListener('pagehide', drop);
  }
}

AudioEngine._workletLoaded = new WeakSet();

/**
 * Conservative end-trim applied once at capture. Deliberately gentler than the
 * scoring trim: this audio is what the player actually hears, so cutting a
 * breath is worse than leaving one in.
 */
function trimForTake(samples, sampleRate) {
  const scale = sampleRate / ANALYSIS_RATE;
  const win = Math.max(64, Math.round(160 * scale));
  const trimmed = trimSilence(samples, { padMs: 120, win, sampleRate });
  // If the trim would leave us with almost nothing, keep the original: a very
  // quiet take is still a take, and silence is reported separately.
  return trimmed.length > sampleRate * MIN_TAKE_SECONDS ? trimmed : samples;
}
