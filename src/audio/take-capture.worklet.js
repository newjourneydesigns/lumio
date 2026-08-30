/**
 * take-capture.worklet.js — the only thing that touches raw microphone samples.
 *
 * Two jobs, one node:
 *   1. While armed, forward every 128-frame quantum to the main thread.
 *   2. Always report a peak/RMS level so the UI can draw a live meter,
 *      throttled to roughly 60 packets a second.
 *
 * Served as a real static file rather than a Blob URL: a blob: script needs
 * `blob:` in the page's CSP and has a history of breaking in WebKit.
 */
class TakeCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.framesSinceMeter = 0;
    this.port.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === 'arm') this.armed = true;
      else if (type === 'disarm') this.armed = false;
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];

    // No input yet (the graph is still warming up) — stay alive and wait.
    if (!channel || channel.length === 0) return true;

    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sumSquares += v * v;
    }

    if (this.armed) {
      // The engine reuses this Float32Array on the next quantum, so we must
      // take our own copy — and then transfer it, so the copy is not cloned again.
      const copy = channel.slice(0);
      this.port.postMessage({ type: 'samples', samples: copy }, [copy.buffer]);
    }

    this.framesSinceMeter += channel.length;
    if (this.framesSinceMeter >= 256) {
      this.framesSinceMeter = 0;
      this.port.postMessage({
        type: 'level',
        peak,
        rms: Math.sqrt(sumSquares / channel.length),
      });
    }

    // Returning false would retire the node permanently.
    return true;
  }
}

registerProcessor('take-capture', TakeCaptureProcessor);
