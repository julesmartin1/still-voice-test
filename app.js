import { TITLE, TEXT } from "./chapter.js";
const $ = (i) => document.getElementById(i);
const KEY = "voice-test-state", GAP = 0.25, STARTUP_MS = 4 * 60000, PIECE_MS = { A: 4 * 60000, B: 10 * 60000 }, GIVE_UP = 3, VERSION = 2, SLOW_LIMIT = 15 * 60000;
// Split into sentences, then keep each piece short enough for the voice.
function pieces(text) {
  const out = [];
  for (const s of text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || []) {
    let rest = s.trim();
    while (rest.length > 340) {
      const cut = Math.max(rest.lastIndexOf(", ", 340), rest.lastIndexOf("; ", 340), rest.lastIndexOf(" ", 340));
      out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}
const PIECES = pieces(TEXT);
const fresh = () => ({ status: "idle", engine: "A", done: {}, crashes: 0, noProgress: 0, crashLog: [], tried: [], stage: "", hidden: 0, started: 0, results: {} });
let st; try { st = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { st = fresh(); }
let wiped = false;
const save = () => { if (wiped) return; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
let stageAt = Date.now();
const NAME = { A: "Fast engine", B: "Slow engine" };
// Keeps a timed list of steps, so a hang shows exactly where it happened.
const stage = (s) => { st.stage = s; stageAt = Date.now(); (st.timeline ||= []).push(`${st.engine} ${new Date().toTimeString().slice(0, 8)} ${s}`); st.timeline = st.timeline.slice(-30); save(); };
let db;
const openDb = () => new Promise((ok, no) => { const r = indexedDB.open("voice-test", 1); r.onupgradeneeded = () => r.result.createObjectStore("pieces"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx = (mode) => db.transaction("pieces", mode).objectStore("pieces");
const put = (k, v) => new Promise((ok, no) => { const r = tx("readwrite").put(v, k); r.onsuccess = ok; r.onerror = () => no(r.error); });
const get = (k) => new Promise((ok, no) => { const r = tx("readonly").get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const clear = () => new Promise((ok, no) => { const r = tx("readwrite").clear(); r.onsuccess = ok; r.onerror = () => no(r.error); });
const say = (a, b = "") => { $("status").textContent = a; $("sub").textContent = b; };
const doneCount = () => Object.keys(st.done).length;
const bar = () => { $("bar").hidden = false; $("fill").style.width = (doneCount() / PIECES.length) * 100 + "%"; };
document.addEventListener("visibilitychange", () => { if (document.hidden) { st.hidden++; save(); } else if (st.status === "running") arm(); });
let worker, watchdog;
const crashOut = (why) => { st.crashes++; st.noProgress++; st.crashLog.push(`${st.engine}: ${why} during "${st.stage}"`); st.status = "restarting"; save(); worker?.terminate(); location.reload(); };
// A hidden page is paused by Safari, so that isn't counted as stuck.
// A hang won't fix itself by retrying, so being stuck moves straight on to the next engine.
let limit = STARTUP_MS;
function arm(ms = limit) { limit = ms; clearTimeout(watchdog); watchdog = setTimeout(() => { if (document.hidden) return arm(); st.noProgress = GIVE_UP; crashOut(`stuck for ${Math.round(limit / 60000)} min`); }, ms); }
function nextIndex() { for (let i = 0; i < PIECES.length; i++) if (!st.done[i]) return i; return -1; }
function makeNext() {
  const i = nextIndex();
  if (i < 0) return finished();
  stage(`making piece ${i + 1} of ${PIECES.length}`);
  say(`Making audio: piece ${i + 1} of ${PIECES.length}`, st.crashes ? `Recovered from ${st.crashes} crash${st.crashes > 1 ? "es" : ""} so far.` : "Keep this page open.");
  bar(); arm(PIECE_MS[st.engine]); worker.postMessage({ type: "make", i, text: PIECES[i] });
}
function run() {
  worker?.terminate();
  st.status = "running"; if (!st.started) st.started = Date.now(); if (!st.tried.includes(st.engine)) st.tried.push(st.engine); if (st.engine === "B") st.slowStart ||= Date.now();
  stage("starting the voice engine"); say("Starting the voice engine…", st.engine === "A" ? "The first time, this downloads about 330 MB." : "The first time, this downloads about 90 MB."); bar(); arm(STARTUP_MS); running();
  worker = new Worker("worker.js?v=2", { type: "module" });
  worker.onerror = (e) => crashOut("worker error: " + (e.message || "").slice(0, 120));
  worker.onmessage = async ({ data: m }) => {
    if (m.type === "download") { arm(STARTUP_MS); if (st.stage !== "downloading the voice") stage("downloading the voice"); say(`Downloading the voice: ${m.pct}%`, "Only needed once."); }
    if (m.type === "stage") { arm(STARTUP_MS); stage(m.text); say("Getting the voice ready…", "This can take a few minutes on a phone."); }
    if (m.type === "ready") { (st.startups ||= []).push(`${st.engine} ${Math.round(m.ms / 1000)}s`); save(); makeNext(); }
    if (m.type === "piece") {
      await put(m.i, { pcm: m.pcm, rate: m.rate });
      st.done[m.i] = { ms: m.ms, audio: Math.round((m.pcm.byteLength / 2 / m.rate) * 1000), e: st.engine, peak: m.peak };
      st.noProgress = 0; save();
      if (st.engine === "B" && nextIndex() >= 0 && Date.now() - st.slowStart > SLOW_LIMIT) return timeLimit();
      makeNext();
    }
    if (m.type === "error") crashOut("error: " + m.message);
  };
  worker.postMessage({ type: "init", engine: st.engine });
}
async function finished() {
  stopTicking(); clearTimeout(watchdog); worker?.terminate();
  st.status = "finished"; st.finished = Date.now(); stage("finished"); summarise();
  bar(); say("Finished. The audio is on this phone.", "The voice engine is off now. Press play to hear it.");
  await showPlayer(); showResults();
}
function summarise() {
  const list = Object.values(st.done), gen = list.reduce((a, d) => a + d.ms, 0), aud = list.reduce((a, d) => a + d.audio, 0);
  const speeds = list.map((d) => d.audio / d.ms).sort((a, b) => a - b);
  st.results[st.tried.join("+")] = { pieces: list.length, audioMin: +(aud / 60000).toFixed(1), makeMin: +(gen / 60000).toFixed(1), speed: +(aud / gen || 0).toFixed(2), slowest: +(speeds[0] || 0).toFixed(2), wallMin: +((Date.now() - st.started) / 60000).toFixed(1), crashes: st.crashes };
  save();
}
async function showPlayer() {
  const parts = []; let rate = 24000, n = 0;
  for (let i = 0; i < PIECES.length; i++) { const p = await get(i); if (!p) continue; rate = p.rate; parts.push(p.pcm); n += p.pcm.byteLength + Math.round(rate * GAP) * 2; }
  const h = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, n, true);
  const gap = new ArrayBuffer(Math.round(rate * GAP) * 2), blobs = [h.buffer];
  for (const p of parts) blobs.push(p, gap);
  $("player").src = URL.createObjectURL(new Blob(blobs, { type: "audio/wav" })); $("player").hidden = false;
}
function byEngine() {
  return ["A", "B"].map((e) => {
    const l = Object.values(st.done).filter((d) => d.e === e); if (!l.length) return "";
    const aud = l.reduce((a, d) => a + d.audio, 0), gen = l.reduce((a, d) => a + d.ms, 0);
    return `${e}: ${l.length} pieces, ${(aud / gen).toFixed(2)}x, quietest ${Math.min(...l.map((d) => d.peak))}`;
  }).filter(Boolean).join("; ") || "none";
}
let gpu = "not checked yet", store = "not checked yet";
async function checkDevice() {
  gpu = "none";
  try { const a = await navigator.gpu?.requestAdapter(); if (a) gpu = `${a.info?.vendor || "?"} ${a.info?.architecture || ""} maxBuffer=${Math.round(a.limits.maxBufferSize / 1048576)}MB`; } catch (e) { gpu = "error " + e.message; }
  try { const e = await navigator.storage.estimate(); store = Math.round(e.usage / 1048576) + "MB used of " + Math.round(e.quota / 1048576) + "MB"; } catch { store = "?"; }
}
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
let ticker;
// While running: show that it's alive, and keep the results ready to copy at any moment.
function running() {
  $("after").hidden = false; $("skip").hidden = st.engine !== "A"; clearInterval(ticker);
  const tick = () => { $("live").textContent = `${NAME[st.engine]}: on this step for ${clock(Date.now() - stageAt)}`; if (document.activeElement !== $("results")) $("results").value = resultsText(); };
  tick(); ticker = setInterval(tick, 1000);
}
function stopTicking() { clearInterval(ticker); $("live").textContent = ""; $("skip").hidden = true; }
function resultsText() {
  return ["VOICE TEST RESULTS", "Version: " + VERSION, "Browser: " + navigator.userAgent, "Screen: " + screen.width + "x" + screen.height + " @" + devicePixelRatio, "Graphics: " + gpu, "Storage: " + store,
    "Status: " + st.status + " (" + st.stage + ")", "Engines tried: " + st.tried.join(", "), "Pieces: " + doneCount() + " of " + PIECES.length, "By engine: " + byEngine(),  "Crashes: " + st.crashes, "Page hidden: " + st.hidden + " times",
    "Startups: " + (st.startups || []).join(", "), "Results: " + JSON.stringify(st.results), "Current step: " + st.stage + " for " + clock(Date.now() - stageAt), "Crash log:", ...st.crashLog.slice(-25), "Steps:", ...(st.timeline || [])].join("\n");
}
async function showResults() {
  $("after").hidden = false; $("results").value = resultsText(); $("reset").hidden = false;
  const other = st.tried.includes("B") ? (st.tried.includes("A") ? "" : "A") : "B";
  $("other").hidden = !other || st.status !== "finished"; $("other").dataset.e = other; $("other").textContent = "Optional: run it again with engine " + other;
}
// The slow engine could run for hours, and 15 minutes is enough to measure it.
const LIMIT_MSG = ["It works here, but slowly.", "It stopped after 15 minutes to save your time. Press play to hear what it made, then copy the results."];
async function timeLimit() {
  stopTicking(); clearTimeout(watchdog); worker?.terminate(); summarise();
  st.status = "stopped"; stage("time limit"); bar(); say(...LIMIT_MSG);
  await showPlayer(); showResults();
}
function giveUp() {
  stopTicking(); clearTimeout(watchdog); summarise();
  if (st.engine === "A" && !st.tried.includes("B")) { st.engine = "B"; st.noProgress = 0; save(); return run(); }
  st.status = "stopped"; stage("gave up"); bar();
  say("The voice couldn't keep running on this phone.", `It crashed ${st.crashes} times. Please copy the results below and send them to Claude.`);
  showResults();
}
$("start").onclick = () => { $("start").hidden = true; $("steps").hidden = true; $("intro").hidden = true; run(); };
$("skip").onclick = () => { st.crashLog.push(`A: skipped by hand during "${st.stage}" after ${clock(Date.now() - stageAt)}`); st.noProgress = GIVE_UP; st.status = "restarting"; save(); worker?.terminate(); location.reload(); };
$("copy").onclick = async () => { const t = $("results").value; try { await navigator.clipboard.writeText(t); $("copy").textContent = "Copied"; } catch { $("results").select(); document.execCommand("copy"); $("copy").textContent = "Copied"; } };
$("reset").onclick = async () => { wiped = true; await clear(); localStorage.removeItem(KEY); location.reload(); };
$("other").onclick = async () => { const e = $("other").dataset.e, keep = { results: st.results, tried: st.tried, startups: st.startups, crashLog: st.crashLog, crashes: 0 }; await clear(); st = { ...fresh(), ...keep, engine: e }; save(); location.reload(); };
window.addEventListener("error", (e) => { st.crashLog.push("page error: " + String(e.message).slice(0, 120)); save(); });
(async () => {
  checkDevice();
  db = await openDb();
  $("start").disabled = false;
  if (!navigator.gpu && st.status === "idle") { st.engine = "B"; st.tried.push("A (no graphics access)"); }
  if (st.status === "running" || st.status === "restarting") {
    // Reopened while it was running, so the last run died. A restart we asked for is already counted.
    if (st.status === "running") { st.crashes++; st.noProgress++; st.crashLog.push(`${st.engine}: page died during "${st.stage}"`); save(); }
    $("start").hidden = $("steps").hidden = $("intro").hidden = true;
    if (st.noProgress >= GIVE_UP) giveUp(); else run();
  } else if (st.status === "finished") {
    $("start").hidden = $("steps").hidden = $("intro").hidden = true; bar();
    say("Finished. The audio is on this phone.", "Press play to hear it."); await showPlayer(); showResults();
  } else if (st.status === "stopped") {
    $("start").hidden = $("steps").hidden = $("intro").hidden = true; bar();
    if (st.stage === "time limit") { say(...LIMIT_MSG); await showPlayer(); } else say("The voice couldn't keep running on this phone.", "Please copy the results and send them to Claude.");
    showResults();
  } else if (Object.keys(st.results).length) { $("start").hidden = $("steps").hidden = $("intro").hidden = true; run(); }
})();
window.__test = { PIECES, st: () => st };
