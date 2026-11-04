// Runs the Kokoro voice. Engine A: fp32 on the graphics chip (fast, more memory).
// Engine B: q8 on the processor (slow, less memory). fp16 on the graphics chip came out silent, so it isn't used.
const ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const here = (p) => new URL(p, self.location.href).href;
let tts = null;
async function init(engine) {
  const progress_callback = (i) => {
    if (i.status === "progress" && /onnx$/.test(i.file || "")) postMessage({ type: "download", pct: Math.round(i.progress) });
    if (i.status === "done" && /onnx$/.test(i.file || "")) postMessage({ type: "stage", text: "preparing the voice" });
  };
  postMessage({ type: "stage", text: "loading the voice software" });
  const lib = await import("./vendor/web/kokoro.web.js");
  postMessage({ type: "stage", text: "opening the voice" });
  lib.env.wasmPaths = here("./vendor/web/");
  const setup = engine === "A" ? { dtype: "fp32", device: "webgpu" } : { dtype: "q8", device: "wasm" };
  tts = await lib.KokoroTTS.from_pretrained(ID, { ...setup, progress_callback });
}
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      const t = performance.now();
      await init(m.engine);
      postMessage({ type: "ready", ms: Math.round(performance.now() - t) });
    } else if (m.type === "make") {
      const t = performance.now();
      const a = await tts.generate(m.text, { voice: "af_heart", speed: 1 });
      const ms = Math.round(performance.now() - t);
      const pcm = new Int16Array(a.audio.length);
      let peak = 0, bad = 0;
      for (let i = 0; i < pcm.length; i++) {
        const v = a.audio[i];
        if (!Number.isFinite(v)) bad++;
        else peak = Math.max(peak, Math.abs(v));
        pcm[i] = Math.max(-1, Math.min(1, v)) * 32767;
      }
      // Fast silence would look like a great result, so it counts as a failure.
      if (bad || peak < 0.01) return postMessage({ type: "error", message: `silent audio (${bad} broken samples, loudest ${peak.toFixed(3)})` });
      postMessage({ type: "piece", i: m.i, ms, rate: a.sampling_rate, peak: +peak.toFixed(3), pcm: pcm.buffer }, [pcm.buffer]);
    }
  } catch (e) {
    postMessage({ type: "error", message: String(e?.message || e).slice(0, 300) });
  }
};
