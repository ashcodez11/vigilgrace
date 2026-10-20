# Third-party notices — evaluation assets

This directory evaluates a publicly released pretrained model against a public
research dataset. Both are used here for non-commercial research only. Nothing
in this directory is bundled into the VigilGrace app.

## YAMNet (model)

* Source: <https://tfhub.dev/google/yamnet/1> (redirects to
  <https://www.kaggle.com/models/google/yamnet>); reference implementation and
  parameters: <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>
* Downloaded artefact: the quantised classification TFLite
  (`?lite-format=tflite`), 4 126 810 bytes,
  sha256 `10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de`
* Licence: Apache License 2.0 (<https://github.com/tensorflow/models/blob/master/LICENSE>,
  <https://www.apache.org/licenses/LICENSE-2.0>). Commercial use and
  redistribution are permitted under the licence terms, including retaining
  this notice.
* Architecture and I/O (per the upstream README): MobileNet V1 depthwise
  separable convolutions, 3.7 M weights, mono 16 kHz input, 64-band log-mel
  features over 0.96 s patches, 521 sigmoid outputs.

## AudioSet ontology / YAMNet class map

* Class map: <https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv>
  (from the Apache-2.0 `tensorflow/models` repository)
* The label vocabulary is the AudioSet ontology, licensed **CC BY-SA 4.0**
  (<https://github.com/audioset/ontology>,
  <https://research.google.com/audioset/download.html>). Share adaptations of
  the ontology under the same licence and attribute Google/AudioSet.

## ESC-50 (audio, metadata)

* Source: <https://github.com/karolpiczak/ESC-50>
* Licence: **CC BY-NC 3.0** — <https://github.com/karolpiczak/ESC-50/blob/master/LICENSE>.
  Non-commercial use only. The audio is **not** redistributed with VigilGrace
  and **must not** be used to train a shipped model.
* ESC-10 is described in the same repository as CC BY 3.0, while the DCASE
  catalogue lists it as CC BY-NC 3.0 (conflict noted in the research document);
  this harness therefore uses ESC-50 clips for benchmarking only, which the
  repository's own licence permits for non-commercial research.
* Individual clips originate from Freesound and carry their own attributions;
  see the dataset repository.

## Reported benchmark values used for comparison

* Verma & Pilanci, *Thinking While Listening: Simple Test Time Scaling For Audio
  Classification* (2025) reports 84 % top-1 for a frozen YAMNet baseline on
  ESC-50: <https://arxiv.org/html/2509.19676v1>. That is a 50-class
  closed-set classification result and is **not** comparable to the one-class
  zero-shot numbers measured here.
