# Pretrained audio models for VigilGrace — research, measurement, decision

Date: 2026-10-18 · Branch: `feat/dual-theme-eas-apk` · Scope: phone-based audio
detection only (the Bluetooth pendant is gone; none of this reintroduces it).

**Decision in one line:** YAMNet is measurable, licence-clean and fast enough to
benchmark, but it is **not integrated** — scream/distress recall cannot be
measured with openly licensed data, sensitivity collapses under noise, and no
on-device runtime was verified. The shipped acoustic prototype is unchanged; this
document plus [`../evaluation/`](../evaluation/README.md) is the evidence base
for revisiting that decision.

Nothing in this work changes SOS, countdown/cancel, idempotency, verified-contact
filtering, evidence handling, authentication or backend contracts. No real alerts
were sent and no audio left the machine.

---

## 1. What the shipped implementation actually does

`src/core/voice/acoustic-analyzer.ts` is a rule-based, on-device prototype:

* streams 16 kHz mono float32 windows from `expo-audio`'s `AudioStream`;
* computes RMS in dBFS and zero-crossing rate (ZCR) per window;
* raises a *candidate* event when the level stays above a preset threshold long
  enough (hysteresis + cooldown) and the confidence derived from exceedance ×
  voicing passes `minConfidence`;
* presets: `low` −18 dBFS / 350 ms / 0.65 · `medium` −24 dBFS / 250 ms / 0.55 ·
  `high` −30 dBFS / 150 ms / 0.45;
* **no** speech recognition, **no** keyword matching, **no** classification model;
* only scalar features leave the analyzer — no audio is written or uploaded.

Two honesty defects were found and fixed while auditing this screen, because both
claims were stronger than the code:

1. `src/app/(app)/voice.tsx` said keywords "are matched with a lightweight
   normalized scorer … They contribute a small confidence boost". Nothing in the
   codebase matches keywords against audio: `AcousticConfig.keywords` is only
   stored (settings store → `useVoiceMonitor`) and never scored. The screen now
   says the list is inactive and saved for a future recogniser.
2. The same screen displayed a "candidate threshold" (`0.5/0.65/0.8`) that did not
   match `ACOUSTIC_PRESETS`. It now renders the real preset values.

Neither change alters detection behaviour.

## 2. Candidates considered

| Candidate | What it is | Runtime / size | Licence | Verdict here |
|---|---|---|---|---|
| **YAMNet** (AudioSet) | MobileNet-V1 depthwise, 521 AudioSet classes, 3.7 M weights, 16 kHz mono, 64-band log-mel, 0.96 s patches | Official TFLite classification build: **4 126 810 bytes** (measured); runs on-device with TFLite | Model Apache-2.0; ontology CC BY-SA 4.0; AudioSet audio is YouTube-hosted and **not** redistributable | **Evaluated** — the only candidate with a licensed, downloadable, mobile-shaped model |
| **CREMA-D** | 7 442 acted clips, 91 actors, six emotions (anger, disgust, fear, happy, neutral, sad), four intensity levels | Audio-only release ≈ 579 MiB / 1.65 GiB via TFDS; full media repo ≈ 7.55 GB via Git LFS + access form | Database ODbL 1.0, contents DbCL 1.0 (commercial use permitted, subject to conditions and to the actors' own rights) | **Rejected for safety use.** It is *acted emotional speech*, not distress or emergency audio; its labels support exploratory emotion research only. Nothing in it is a "person in danger" label |
| **ESC-50 / ESC-10** | 2 000 / 400 five-second field recordings, 50 / 10 classes, 44.1 kHz mono; folds group clips from the same source recording | ≈ 600 MB archive | **CC BY-NC 3.0** (ESC-50); ESC-10 is described as CC BY 3.0 in the repo but listed CC BY-NC 3.0 by DCASE — unresolved conflict | **Benchmark only.** The class list contains `crying_baby` but **no screaming class**; non-commercial and not trainable into a shipped model |
| AudioSet audio | Ontology CC BY-SA 4.0; annotations CC BY 4.0 | No audio download — only YouTube IDs, timestamps, labels and precomputed features | — | Not usable: the audio is not redistributable and cannot be fetched lawfully here |
| VGGish, PANNs/CNN14, AST, keyword-spotting models | Larger or speech-only alternatives in the same problem space | Not measured here — no mobile runtime and no device available | varies | Not selected. VGGish is the superseded predecessor of YAMNet in the same repository; the others are larger than the TFLite ceiling this app can carry. No size, latency or accuracy claim is made for them, because nothing was measured |

Sources (all fetched 2026-10-18):

* YAMNet model/reference: <https://tfhub.dev/google/yamnet/1>,
  <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>,
  <https://www.tensorflow.org/hub/tutorials/yamnet>
* Apache-2.0 licence for `tensorflow/models`: <https://github.com/tensorflow/models/blob/master/LICENSE>
* AudioSet ontology (CC BY-SA 4.0) and dataset terms: <https://research.google.com/audioset/download.html>,
  <https://github.com/audioset/ontology>
* Class map (Shout = index 6, Screaming = 11, Crying/sobbing = 19, Baby cry = 20):
  <https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv>
* ESC-50 repository, licence and metadata: <https://github.com/karolpiczak/ESC-50>,
  <https://github.com/karolpiczak/ESC-50/blob/master/LICENSE>,
  <https://raw.githubusercontent.com/karolpiczak/ESC-50/master/meta/esc50.csv>,
  <https://dcase-repo.github.io/dcase_datalist/datasets/sounds/esc_50.html>
* CREMA-D: <https://github.com/CheyneyComputerScience/CREMA-D>,
  <https://www.tensorflow.org/datasets/catalog/crema_d>,
  ODbL: <https://opendatacommons.org/licenses/odbl/1-0/>
* Published YAMNet/ESC-50 reference point (84 % top-1, frozen baseline, 50-class
  closed-set): <https://arxiv.org/html/2509.19676v1>
* Scream-detection evidence that is **not** YAMNet (VGGish + gradient-boosted
  trees, ROC-AUC 0.86 on held-out AudioSet clips, average precision 42 % on full
  TV episodes with screams at 1.3 % of audio):
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC7327591/>
* Far-field/microphone domain mismatch: room acoustics
  (<https://www.microsoft.com/en-us/research/publication/the-effect-of-room-acoustics-on-audio-event-classification/>)
  and recording-device variability (<https://arxiv.org/html/2401.06913v1>).

## 3. Domain mismatch — the part that matters

YAMNet is trained on AudioSet, whose clips are mostly *curated YouTube audio*:
near-field, produced, often music-adjacent. A phone in a pocket or on a bedside
table is the opposite: far-field, reverberant, low-pass filtered by fabric,
dominated by whatever else is in the room. The sources above document that room
acoustics and recording device measurably change sound-event classification, and
none of them measures YAMNet on phone-mic distress audio.

Consequences that this document does **not** claim away:

* `Screaming` in the AudioSet vocabulary is a *sound category*, not a statement
  about a person's safety. A model that fires on TV, arguments, sports, laughter
  or a cat does not know anything about danger.
* YAMNet's own evaluation is reported as balanced mAP 0.306 over 521 classes on
  AudioSet — strong for a small model, but a per-class, per-channel number that
  says nothing about screams recorded by this app on a phone.
* No published, openly licensed evaluation of YAMNet for screams or distress was
  found. The one scream-detection study located (VGGish + GBT) is a different
  model, a different corpus and explicitly reports confusion with laughter and
  crying.

## 4. Evaluation pipeline (reproducible)

Everything is in [`../evaluation/`](../evaluation/README.md); the harness is
separate from the app and imports nothing from it.

* **Assets** — `fetch_assets.py` downloads the model, the class map and the
  ESC-50 metadata, verifies sha256 for each (and refuses to continue on a
  mismatch), then downloads clips one at a time and records per-clip sha256 plus
  an aggregate `manifest_sha256`.
* **Model input** — 16 kHz mono, int16 → float, `resample_poly(160/441)` from
  ESC-50's 44.1 kHz, 15 600-sample (0.975 s) windows with a 7 800-sample
  (0.4875 s) hop and zero padding on the tail.
* **Split** — ESC-50's `fold` column groups clips by original source recording;
  per-fold metrics are reported. There is no training step, so no train/test
  leakage is possible.
* **Metrics** — confusion matrix, precision, recall, F1, FPR (+ Wilson 95 %
  intervals), class balance, per-category breakdown, threshold sweep, and a
  re-implementation of the shipped dBFS + ZCR heuristic scored on the same clips
  as the baseline.
* **Noise condition** — deterministic synthetic additive white noise at 10 dB and
  5 dB SNR (seeded by CRC32 of the filename) over the 40 cry clips plus a
  stratified 100-clip sample of the rest. This is white noise, **not** recorded
  babble/traffic; it is a lower bound on real-world difficulty, not a substitute.
* **Latency** — wall-clock per window on the desktop CPU with the XNNPACK
  delegate (2 threads), after warm-up. Phone latency was **not** measured.

Dataset used: 2 000 ESC-50 clips, all 50 categories, `manifest_sha256`
`0579d057bcbf7c44e145e7033179565b42c31a70a443a1349abdbfb322bc864e`.

## 5. Measured results

Threshold 0.5 on the `Baby cry, infant cry` output unless stated. All numbers come
from `evaluation/results/results.json` and `per_clip.csv`; nothing here is
estimated.

### Task A — zero-shot infant-cry detection (40 positives / 1 960 negatives)

| Detector | Precision | Recall | F1 | FPR | TP / FP / FN / TN |
|---|---|---|---|---|---|
| **YAMNet `Baby cry` ≥ 0.5** | **0.850** | **0.850** | **0.850** | **0.0031** | 34 / 6 / 6 / 1954 |
| Shipped heuristic, `medium` | 0.036 | 0.900 | 0.069 | 0.494 | 36 / 968 / 4 / 992 |
| Shipped heuristic, `low` | 0.030 | 0.275 | 0.054 | 0.182 | 11 / 357 / 29 / 1603 |
| Shipped heuristic, `high` | 0.026 | 1.000 | 0.051 | 0.762 | 40 / 1494 / 0 / 466 |

Per-fold F1 for YAMNet: 0.67, 1.00, 1.00, 0.82, 0.75 (folds 1 and 5 carry all
the misses — quiet, distant or overlapping cries).

Threshold sweep (YAMNet `Baby cry`):

| Threshold | 0.05 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Precision | 0.488 | 0.625 | 0.771 | 0.800 | 0.829 | 0.850 | 0.909 | 0.938 | 0.920 | 1.000 |
| Recall | 1.000 | 1.000 | 0.925 | 0.900 | 0.850 | 0.850 | 0.750 | 0.750 | 0.575 | 0.300 |
| F1 | 0.656 | 0.769 | 0.841 | **0.847** | 0.840 | 0.850 | 0.822 | 0.833 | 0.708 | 0.462 |
| FPR | 0.0214 | 0.0122 | 0.0056 | 0.0046 | 0.0036 | 0.0031 | 0.0015 | 0.0010 | 0.0010 | 0.0000 |

The six false positives at 0.5 are three `cat` clips (0.67, 0.85, 0.59) and three
`door_wood_creaks` clips (0.80, 0.59, 0.50); the six misses are quiet cries
scoring 0.11–0.33. Cat meows and creaking doors are the confusions to expect in a
real room.

**Interpretation, stated carefully:** YAMNet recovers a *labelled infant-cry*
class zero-shot, and — unlike the amplitude heuristic — it does so with 0.3 % FPR
instead of 49 %. That is evidence the pretrained model is useful *as a sound
context signal*. It is **not** evidence that it detects a person in danger: the
app's own user is not an infant, `crying_baby` is not `screaming`, and the
heuristic was never designed to detect cries (it detects loud sustained voiced
sound, which is why it fires on half of all everyday ESC-50 clips).

### Task B — scream-alarm false positives (1 960 everyday clips, no screams present)

| Threshold | `Screaming` FPR | `Shout` FPR |
|---|---|---|
| 0.3 | 0.0015 | 0.0000 |
| 0.5 | 0.0005 (1 clip) | 0.0000 |
| 0.7 | 0.0000 | 0.0000 |
| 0.9 | 0.0000 | 0.0000 |

Highest `Screaming` scores outside the cry class: `laughing` 0.668 (1 clip of 40
above 0.5), `coughing` 0.332, `crow` 0.262, `cat` 0.199, `sneezing` 0.199.
`Shout` never exceeded **0.148** on any clip (highest: `siren`, then
`vacuum_cleaner` 0.109) — well below every threshold tested, which is why its
FPR is 0 at 0.3–0.9.

**Recall for screams is not measured and cannot be measured with this dataset.**
ESC-50 contains no screaming class, AudioSet audio is not redistributable, and the
scream corpora located during research are request-gated or non-redistributable.
A low false-positive rate with unknown recall says nothing about whether the model
would notice a real scream.

### Task D — synthetic noise robustness (baby-cry task, threshold 0.5)

| Condition | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Clean | 0.850 | 0.850 | 0.850 | 0.0031 |
| 10 dB SNR white noise | 0.963 | 0.650 | 0.776 | 0.0081 |
| 5 dB SNR white noise | 0.933 | 0.350 | 0.509 | 0.0081 |

Recall roughly halves for every 5 dB of added broadband noise. Real pocket audio
is worse than this synthetic condition, not better.

### Task E — latency and footprint (desktop CPU only)

* Model file: 4 126 810 bytes.
* Per 0.975 s window: median **2.59 ms**, p95 **3.27 ms**, max 3.28 ms.
* Machine: macOS x86_64, XNNPACK delegate, 2 threads. Phone latency, battery and
  thermal behaviour were **not** measured; treat the desktop figure as a lower
  bound and nothing more.

## 6. Shake detection

The sensor path was audited separately with synthetic 60 Hz sequences; the
detector code was not modified. Two false-positive paths are documented with
reproducible numbers in
[`SHAKE_DETECTION_AUDIT.md`](SHAKE_DETECTION_AUDIT.md) and
`tests/shake-audit.test.ts`. No pretrained model is used or proposed for shake
detection: there is no evidence that a learned model beats a threshold detector
on this signal, and the failure modes found are threshold artefacts, not
modelling gaps.

## 7. Integration decision

**Not integrated. YAMNet was evaluated, not shipped.** Reasons, each tied to a
measurement or a missing input above:

1. **The label that matters is unmeasurable here.** `Screaming` recall has never
   been quantified on any corpus this project can use. Shipping a safety trigger
   whose sensitivity is unknown would break the project's own rule: no claim of
   distress detection without appropriate evaluation.
2. **The proxy task does not transfer.** The cry class works on clean clips, but
   it measures infant crying, and its recall collapses to 0.35 at 5 dB SNR — the
   regime pocket microphones live in.
3. **No verified on-device runtime.** Expo Go cannot host a TFLite model; an
   integration needs a native module and a development build. No device was
   available to measure latency, thermals, battery or background behaviour, and a
   model that stutters or is killed would add nothing to the safety path.
4. **False alarms have a real cost.** The existing mitigation — candidate events
   require corroboration, shake/voice trigger a cancellable countdown, and SOS
   dispatch only reaches *verified* contacts — is what makes a noisy detector
   tolerable. Adding a model whose FPR on the user's own home sounds is unmeasured
   would spend that margin for unknown gain.

### What is missing before a future integration could be justified

* An openly licensed adult scream / scream-proximate corpus (or a small,
  consented, on-device pilot set) recorded through **phone microphones** at
  realistic distances, with per-recording splits.
* A measured precision/recall/FPR operating point for adult distress audio on
  that corpus, reported with confidence intervals — not a clean-clip number.
* On-device measurements: per-window latency, memory, battery impact, behaviour
  while backgrounded, and graceful behaviour when the model file is missing or the
  runtime fails.
* A written false-alarm analysis covering the app's own mitigation: countdown
  cancellation rate, corroboration requirements, and how a model signal is shown
  to the user as *possible context*, never as proof.

### If it is integrated later, the shape is already determined

* Keep inference on-device, on the same 16 kHz mono stream the prototype already
  consumes; never upload audio.
* Feed the model the same windows; treat `Screaming`/`Shout` (and `Baby cry` only
  where the user asks for it) as **context for a candidate event**, combined with
  the existing dBFS/ZCR burst — never as an auto-SOS trigger.
* Use a conservative threshold plus temporal smoothing (require the class to stay
  above threshold across consecutive windows; the sweep above suggests 0.5–0.7 as
  a starting point, not 0.2–0.3 where FPR grows four-fold).
* Fail open and silently: a missing or broken model must leave manual SOS,
  countdown and shake detection untouched, and must not delay them.
* Label any such feature for what it is ("possible scream-like sound") and keep
  the corroboration requirement on.

## 8. Reproduce

```bash
python3 -m venv venv && ./venv/bin/pip install -r evaluation/requirements.txt
./venv/bin/python evaluation/fetch_assets.py --data-dir /tmp/vg-ai/data
./venv/bin/python evaluation/run_benchmark.py --data-dir /tmp/vg-ai/data --out evaluation/results
cd evaluation && ../venv/bin/python -m unittest discover -s . -p 'test_*.py'
```

Measured on Python 3.11.15 / numpy 1.26.4 / TensorFlow 2.15.1 / macOS x86_64.
Model sha256 `10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de`;
ESC-50 metadata sha256 `ca660da60191a97de289983a05821c9382d852a38a2ba8428980816b68cf6246`;
class map sha256 `cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2`.
