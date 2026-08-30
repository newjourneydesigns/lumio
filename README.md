# Sdrawkcab

**Talk backwards. Badly.** A browser party game.

1. Say a short phrase out loud.
2. Hear it played backwards. It sounds like nonsense.
3. Say that nonsense out loud, as accurately as you can.
4. We play *your* nonsense backwards. If you nailed it, your phrase walks back out — and you get scored on how close you got.

No install, no accounts, no upload. Every recording stays in the tab.

## Running it

It is a static site with no build step.

```sh
npm install       # only needed for the tests
npm run dev       # serves src/ on http://localhost:8000
```

`getUserMedia` requires a secure context, so use `localhost` or https — opening
`index.html` from the filesystem will not work.

## Tests

```sh
node tests/make-fixtures.mjs          # regenerate the synthetic audio fixtures
node --test 'tests/**/*.test.mjs'     # scoring maths, in Node
node tests/e2e.mjs                    # a full round in real Chromium, fake mic
```

The end-to-end test drives an actual browser with
`--use-file-for-fake-audio-capture`, so microphone capture, the AudioWorklet,
playback and the whole four-step flow are genuinely exercised rather than mocked.

## How it works

```
src/
  index.html
  styles.css
  app.webmanifest
  audio/take-capture.worklet.js   raw PCM capture + level metering
  js/
    main.js      boot
    game.js      the four-step round, and all DOM
    copy.js      every word the player reads
    audio.js     mic, recording, reversal, playback, WAV export
    dsp.js       the scoring maths
    viz.js       waveform rendering
    sfx.js       synthesised interface sounds
    confetti.js  the reward
```

### The audio is never compressed

Capture goes through an `AudioWorklet` as raw `Float32` PCM, not `MediaRecorder`.
That is the load-bearing decision: every lossy encoder adds priming silence to
the front of a file (AAC around 1024–2112 samples, Opus a 6.5 ms pre-skip) and
browsers disagree about trimming it back off. In an ordinary recorder that is
invisible. In a game built on `reverse(reverse(x)) === x` it becomes a different
amount of trailing silence on each take, and it lands straight in the score.
With PCM the identity is exact, and the end-to-end test asserts it sample for
sample.

It also means no codec detection: Safari before 18.4 could only record
`audio/mp4` while Chrome and Firefox emit `webm/opus`, and none of that
fragmentation exists on this path.

### Scoring

The score compares your original recording against your imitation reversed. The
two will never line up sample to sample — same speaker, but different pace,
loudness and room noise — so:

```
resample to 16 kHz -> trim silence -> normalise loudness -> pre-emphasis
-> 25 ms frames -> log-mel spectrogram (26 bands) -> per-utterance CMVN
-> banded DTW on cosine distance
```

The distance is then divided by a **chance baseline**: the same comparison run
against a block-shuffled copy of your attempt, which destroys the order of the
sounds while leaving your voice, your microphone and the room exactly as they
were. Scoring that ratio rather than the raw distance is what stops the game
feeling harsh on one phone and generous on another. A logistic maps the ratio
onto 18–99.

Measured on the test fixtures: a perfect match scores 99, a good-but-human
attempt 78, a sloppy one 44, and a completely different phrase 19. Speaking
louder, quieter, faster or slower barely moves it, which is the point — those
are not the thing being judged.

### Deployment

Static, published from `src/`. See `netlify.toml`.
