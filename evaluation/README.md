# Audio-model evaluation harness (YAMNet / ESC-50)

Reproducible benchmark for the question: *should VigilGrace replace or augment its
acoustic prototype with a pretrained sound-event model?*

Measured results and the integration decision live in
[`../docs/AI_MODEL_AND_DATASET_RESEARCH.md`](../docs/AI_MODEL_AND_DATASET_RESEARCH.md).
The shake-detector audit lives in
[`../docs/SHAKE_DETECTION_AUDIT.md`](../docs/SHAKE_DETECTION_AUDIT.md).

Nothing here ships inside the app. No raw audio is uploaded, and no app code
imports this directory.

## What is measured

| Task | Positive class | Negative class | What it tells you |
|---|---|---|---|
| A | ESC-50 `crying_baby` (40 clips) | the other 49 categories (1960 clips) | Whether a pretrained AudioSet model recovers a **labelled, distress-adjacent** class zero-shot |
| B | — | all 1960 non-cry clips | False-positive rate of the model's `Screaming` / `Shout` outputs on everyday sounds. **Recall for screams is not measurable — ESC-50 contains no screams** |
| C | same as A | same as A | The shipped dBFS + ZCR heuristic (`src/core/voice/acoustic-analyzer.ts`) scored on the same clips |
| D | 40 cry clips + 100 stratified others | — | Degradation with synthetic white noise at 10 dB and 5 dB SNR |
| E | — | — | Desktop CPU inference latency per 0.975 s window |

ESC-50 classes are split by source recording (its `fold` column groups clips by
original Freesound upload), so per-fold numbers are reported as well; there is no
training step, so no leakage into a fitted model is possible.

## Environment (recorded in `results/results.json`)

* Python 3.11.15, numpy 1.26.4, TensorFlow 2.15.1 (TFLite interpreter, XNNPACK, 2 threads)
* macOS, x86_64 CPU
* Model: `yamnet_classification.tflite`, 4 126 810 bytes,
  sha256 `10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de`

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## Run

```bash
# 1. Fetch and checksum-verify the model, class map, and ESC-50 audio (~880 MB).
#    Audio goes to /tmp, never into the repository.
./venv/bin/python evaluation/fetch_assets.py --data-dir /tmp/vg-ai/data

# 2. Score every clip, write evaluation/results/{results.json,per_clip.csv}.
./venv/bin/python evaluation/run_benchmark.py --data-dir /tmp/vg-ai/data --out evaluation/results

# 3. Harness tests (metrics, thresholding, resampling, baseline heuristic).
cd evaluation && ../venv/bin/python -m unittest discover -s . -p 'test_*.py'
```

`fetch_assets.py` refuses to benchmark against an artefact whose sha256 does not
match the recorded value, so the model and the metadata cannot drift silently.
Per-clip hashes are written to `data/manifest.json`; the aggregate
`manifest_sha256` appears in `results.json`.

## Licence and attribution

* YAMNet (Apache-2.0), class map (Apache-2.0 repository; labels are the AudioSet
  ontology, CC BY-SA 4.0) — see [`NOTICE.md`](NOTICE.md).
* ESC-50 audio is **CC BY-NC 3.0**: fine for this non-commercial benchmark, **not**
  redistributable and **not** usable to train a shipped model. The audio is never
  committed and never enters `dist/*.zip`.
