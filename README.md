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

## Installing it

It ships as a PWA. On iOS, Share → Add to Home Screen; on Android, the install
prompt appears on its own. An installed copy works with no signal — the service
worker precaches the whole playable shell, and the fonts are self-hosted, so the
game makes no third-party request while somebody is using their microphone.

Icons and the share card are generated, not hand-drawn:

```sh
node scripts/make-icons.mjs
```

That renders `src/assets/icon-{192,512}.png`, a maskable variant, an
`apple-touch-icon.png` (iOS ignores the manifest and applies its own mask, so it
needs a full-bleed square of its own) and the 1200x630 `og.png`. The artwork is
authored as HTML and screenshotted with the same engine that renders the game.

## Tests

```sh
node tests/make-fixtures.mjs          # regenerate the synthetic audio fixtures
node --test 'tests/**/*.test.mjs'     # 17 checks on the scoring maths, in Node
node tests/e2e.mjs                    # 43 checks: a full round in real Chromium
```

The end-to-end test drives an actual browser with
`--use-file-for-fake-audio-capture`, so microphone capture, the AudioWorklet,
playback and the whole four-step flow are genuinely exercised rather than mocked.
It also asserts the things that are easy to break and hard to notice: that
`reverse(reverse(x))` is sample-exact on real browser audio, that every manifest
icon resolves, that the share card really is 1200x630, and that the page still
loads with the network cut.

Not covered: iOS Safari, Android Chrome, Firefox and desktop Safari. Everything
here has only ever run in headless Chromium on Linux with a synthetic voice.

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

### No score, on purpose

Earlier versions graded each attempt: a log-mel/DTW similarity scorer with a
per-pair chance baseline, a ring, ranks, a best-score streak. It was removed
deliberately — hearing your own gibberish walk back out as (roughly) the
phrase is the payoff, and a number after the punchline just graded the joke.
The mirrored comparison on the reveal stays, because seeing the two shapes
line up is part of the laugh; nothing judges them. The scorer lives in git
history if a scored mode ever returns.

### Loudness

Takes are peak-normalised to 0.92 at capture. Auto gain control is
deliberately disabled on the mic (it chews on reversed speech), which leaves
raw phone recordings peaking at 10-20% of full scale — so without this,
playback was noticeably quiet. The boost is capped at 8x so a silent room is
never amplified into a hiss recording.

### Touch behaviour

`touch-action: manipulation` is set on the page and on every control. This is a
tapping game — you hit the same big button twice in quick succession constantly
— and without it iOS reads that as double-tap-to-zoom and throws the layout
around mid-round. It is deliberately not `user-scalable=no`, which would also
kill pinch-zoom and lock out anyone who needs to magnify the screen.

### Deployment

Static, published from `src/`. See `netlify.toml`.

There is deliberately no catch-all redirect: the app is a single page with no
client-side routing, and a catch-all would turn every missing asset into a 200
serving HTML, which hides real 404s and would poison the service worker cache.
