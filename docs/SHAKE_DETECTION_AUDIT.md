# Shake-to-SOS detector audit

Date: 2026-10-18 · Detector: `src/core/motion/shake-detector.ts` (**not modified**)
· Audit tests: `tests/shake-audit.test.ts` (13 tests) · Existing tests:
`tests/shake-detector.test.ts`

## How the detector works

Each accelerometer sample is reduced to a magnitude; a sample counts as a "peak"
when `|‖a‖ − 1 g| ≥ peakThresholdG` and at least `peakMinSpacingMs` has passed
since the last counted peak. Enough peaks inside a sliding window trigger a
shake, after which `cooldownMs` must elapse.

| Preset | minPeaks | peakThresholdG | windowMs | cooldownMs | peakMinSpacingMs |
|---|---|---|---|---|---|
| low | 4 | 0.50 | 1200 | 10000 | 80 |
| medium (default) | 3 | 0.35 | 1200 | 8000 | 80 |
| high | 3 | 0.25 | 1500 | 10000 | 60 |

Lifecycle (`use-shake-monitor.ts`): the engine is created when `shakeEnabled`
turns on and destroyed on unmount/disable; the config is rebuilt when
`shakeSensitivity` changes; monitoring is foreground-only (Expo sensors stop
delivering samples when the app is backgrounded). Samples are fed at the sensor's
default rate (~60 Hz here).

## Method

`tests/shake-audit.test.ts` replays synthetic 60 Hz magnitude sequences — exactly
what `push()` receives — and asserts what fires. Sequences: walking (1.9 Hz bounce
± 0.25 g + first harmonic), phone at rest with handling noise, a single 2.4 g drop
impact, two isolated 1.6 g bumps 1.3 s apart, a constant 1.4 g offset, deliberate
4 Hz hand shakes, and threshold sweeps per preset. The engine only ever uses the
magnitude, so each sequence is placed on one axis to make `|a|` exact.

## Measured behaviour

| Sequence | low | medium | high |
|---|---|---|---|
| Walking (0.25 g + harmonic, 20 s) | no fire | no fire | **FIRE (F1)** |
| Phone at rest + handling noise | no fire | no fire | no fire |
| Single 2.4 g drop impact | no fire | no fire | no fire |
| Two 1.6 g bumps 1.3 s apart | no fire | no fire | no fire |
| Constant 1.4 g offset (no oscillation) | no fire | **FIRE (F2)** | **FIRE (F2)** |
| Deliberate 4 Hz shake ± 0.9 g | fires ~0.4 s | fires ~0.2 s | fires ~0.15 s |

Threshold sweeps (20 s walking / 3 s shake, fire = at least one trigger):

| Preset | walking fires from | shake fires from |
|---|---|---|
| medium | 0.35 g amplitude | 0.40 g amplitude |
| high | 0.25 g amplitude | 0.30 g amplitude |
| low | ≥ 0.5 g (not reached in sweep) | > 0.5 g amplitude |

### F1 — the high preset fires while walking

`high` uses `peakThresholdG = 0.25`, below the ~0.31 g peak of ordinary walking,
so a walk can start an SOS countdown. `medium` (0.35) and `low` (0.50) are clear
of it at the amplitudes tested.

**Recommended fix (not applied):** raise `high.peakThresholdG` to 0.35 to match
`medium`'s measured noise floor and keep the wider 1500 ms window as the
sensitivity difference. Sweep data for that exact configuration: walking still
fires at ≥ 0.35 g amplitude, deliberate shake fires at ≥ 0.40 g — i.e. the change
removes the *ordinary*-walking case but no threshold-based detector can separate
vigorous walking from shaking. The real mitigation is the existing one: a shake
only opens a cancellable countdown, and dispatch still requires verified contacts.

### F2 — a sustained offset is counted as repeated peaks

A constant non-1 g acceleration (lift, hard braking, phone pressed against
something) counts a fresh peak every `peakMinSpacingMs` and fires within ~250 ms,
even though there is no oscillation at all. Physically this is not a shake.

**Recommended fix (not applied):** require the magnitude to return within
`peakThresholdG` of 1 g before another peak can be counted (rising-edge counting),
or cap one counted peak per `peakMinSpacingMs` *and* require a below-threshold
sample in between. Applying either changes the semantics of a detector that has
already been reported as verified, so it is left to a dedicated change with a
device test — the audit tests assert today's behaviour so such a change is
visible, not silent.

## Missed detections

* `low` ignores a 0.45 g 4 Hz shake entirely — a deliberate but weak shake does
  nothing at that preset. If a user selects `low` expecting *fewer* false alarms
  and shakes gently, they get no countdown. (Documented by test.)
* A single impact (drop) never fires, by design: `minPeaks` is 3, so one phone
  drop cannot trigger an SOS.
* Nothing here measures real phones: sensor rate, filtering and clipping vary by
  device, and no device run was possible. The sequences are synthetic and
  reproducible, which is their point — they are a regression net, not proof of
  field behaviour.

## Recommendation

Keep the threshold detector; no pretrained model is warranted for this signal
(the failures found are threshold artefacts, not unmodelled physics). Apply F1
and F2 as a separate, device-tested change, and update the quick-start copy so
users know a shake only starts a cancellable countdown.
