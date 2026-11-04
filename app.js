import { TITLE, TEXT } from "./chapter.js";
const $ = (i) => document.getElementById(i);
const KEY = "voice-test-state", GAP = 0.25, STUCK_MS = 600000, GIVE_UP = 3, SLOW_LIMIT = 15 * 60000;
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
const stage = (s) => { st.stage = s; save(); };
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
const crashOut = (why) => { st.crashes++; st.noProgress++; st.crashLog.push(`${st.engine}: ${why} during "${st.stage}"`); st.status = "restarting"; save(); location.reload(); };
// A hidden page is paused by Safari, so that isn't counted as stuck.
function arm() { clearTimeout(watchdog); watchdog = setTimeout(() => (document.hidden ? arm() : crashOut("stuck")), STUCK_MS); }
function nextIndex() { for (let i = 0; i < PIECES.length; i++) if (!st.done[i]) return i; return -1; }
function makeNext() {
  const i = nextIndex();
  if (i < 0) return finished();
  stage(`making piece ${i + 1} of ${PIECES.length}`);
  say(`Making audio: piece ${i + 1} of ${PIECES.length}`, st.crashes ? `Recovered from ${st.crashes} crash${st.crashes > 1 ? "es" : ""} so far.` : "Keep this page open.");
  bar(); arm(); worker.postMessage({ type: "make", i, text: PIECES[i] });
}
function run() {
  st.status = "running"; if (!st.started) st.started = Date.now(); if (!st.tried.includes(st.engine)) st.tried.push(st.engine); if (st.engine === "B") st.slowStart ||= Date.now();
  stage("starting the voice engine"); say("Starting the voice engine…", st.engine === "A" ? "The first time, this downloads about 330 MB." : "The first time, this downloads about 90 MB."); bar(); arm();
  worker = new Worker("worker.js", { type: "module" });
  worker.onerror = (e) => crashOut("worker error: " + (e.message || "").slice(0, 120));
  worker.onmessage = async ({ data: m }) => {
    if (m.type === "download") { arm(); say(`Downloading the voice: ${m.pct}%`, "Only needed once."); }
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
  clearTimeout(watchdog); worker?.terminate();
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
async function resultsText() {
  let gpu = "none";
  try { const a = await navigator.gpu?.requestAdapter(); if (a) gpu = `${a.info?.vendor || "?"} ${a.info?.architecture || ""} maxBuffer=${Math.round(a.limits.maxBufferSize / 1048576)}MB`; } catch (e) { gpu = "error " + e.message; }
  let store = "?"; try { const e = await navigator.storage.estimate(); store = Math.round(e.usage / 1048576) + "MB used of " + Math.round(e.quota / 1048576) + "MB"; } catch {}
  return ["VOICE TEST RESULTS", "Browser: " + navigator.userAgent, "Screen: " + screen.width + "x" + screen.height + " @" + devicePixelRatio, "Graphics: " + gpu, "Storage: " + store,
    "Status: " + st.status + " (" + st.stage + ")", "Engines tried: " + st.tried.join(", "), "Pieces: " + doneCount() + " of " + PIECES.length, "By engine: " + byEngine(),  "Crashes: " + st.crashes, "Page hidden: " + st.hidden + " times",
    "Startups: " + (st.startups || []).join(", "), "Results: " + JSON.stringify(st.results), "Crash log:", ...st.crashLog.slice(-25)].join("\n");
}
async function showResults() {
  $("after").hidden = false; $("results").value = await resultsText(); $("reset").hidden = false;
  const other = st.tried.includes("B") ? (st.tried.includes("A") ? "" : "A") : "B";
  $("other").hidden = !other || st.status !== "finished"; $("other").dataset.e = other; $("other").textContent = "Optional: run it again with engine " + other;
}
// The slow engine could run for hours, and 15 minutes is enough to measure it.
const LIMIT_MSG = ["It works here, but slowly.", "It stopped after 15 minutes to save your time. Press play to hear what it made, then copy the results."];
async function timeLimit() {
  clearTimeout(watchdog); worker?.terminate(); summarise();
  st.status = "stopped"; stage("time limit"); bar(); say(...LIMIT_MSG);
  await showPlayer(); showResults();
}
function giveUp() {
  clearTimeout(watchdog); summarise();
  if (st.engine === "A" && !st.tried.includes("B")) { st.engine = "B"; st.noProgress = 0; save(); return run(); }
  st.status = "stopped"; stage("gave up"); bar();
  say("The voice couldn't keep running on this phone.", `It crashed ${st.crashes} times. Please copy the results below and send them to Claude.`);
  showResults();
}
$("start").onclick = () => { $("start").hidden = true; $("steps").hidden = true; $("intro").hidden = true; run(); };
$("copy").onclick = async () => { const t = $("results").value; try { await navigator.clipboard.writeText(t); $("copy").textContent = "Copied"; } catch { $("results").select(); document.execCommand("copy"); $("copy").textContent = "Copied"; } };
$("reset").onclick = async () => { wiped = true; await clear(); localStorage.removeItem(KEY); location.reload(); };
$("other").onclick = async () => { const e = $("other").dataset.e, keep = { results: st.results, tried: st.tried, startups: st.startups, crashLog: st.crashLog, crashes: 0 }; await clear(); st = { ...fresh(), ...keep, engine: e }; save(); location.reload(); };
window.addEventListener("error", (e) => { st.crashLog.push("page error: " + String(e.message).slice(0, 120)); save(); });
(async () => {
  db = await openDb();
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
