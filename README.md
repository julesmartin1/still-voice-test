# Voice test

A temporary test page. It checks whether the Kokoro text-to-speech voice can make audio ahead of time in iPhone Safari, one piece at a time, recovering if the page crashes. Audio stays on the device, and the page sends no results anywhere.

## Third-party parts

| Part | Licence | Source |
|---|---|---|
| Kokoro-82M model (downloaded from Hugging Face at run time) | Apache-2.0 | https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX |
| kokoro-js | Apache-2.0 | https://github.com/hexgrad/kokoro |
| Transformers.js | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web | MIT | https://github.com/microsoft/onnxruntime |
| phonemizer, which includes eSpeak NG | GPL-3.0 (see `vendor/GPL-3.0.txt`) | https://github.com/espeak-ng/espeak-ng |

The story text is "The Story of an Hour" by Kate Chopin (1894), which is in the public domain.
