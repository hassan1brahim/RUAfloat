/** Unit console: polls /api/dispatch, alerts on new dispatches, and moves them along. Same token as the admin view. */
import "../core/base.css";
import "./style.css";
import { $, esc, et } from "../core/util";

type Status = "pending" | "acknowledged" | "en-route" | "on-scene" | "cleared";
type Dispatch = { id: string; target: string; kind: "road" | "building"; unit: string; status: Status; created: string; history: { status: Status; at: string }[] };

const NEXT_LABEL: Partial<Record<Status, string>> = { pending: "Acknowledge", acknowledged: "Mark en route", "en-route": "Mark on scene", "on-scene": "Clear" };
const KEY = "admin-token";
const token = () => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };

// Browsers only allow sound after a tap, so one context is created by the button and reused for every alert.
let audio: AudioContext | null = null;
function beep() {
  if (!audio) return;
  [880, 660].forEach((f, i) => {
    const osc = audio!.createOscillator(), gain = audio!.createGain(), t = audio!.currentTime + i * 0.22;
    osc.frequency.value = f;
    osc.connect(gain).connect(audio!.destination);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}
$("u-sound").onclick = () => {
  audio ??= new AudioContext();
  void audio.resume();
  beep();
  $("u-sound").textContent = "Alert sound on";
};

let list: Dispatch[] = [], seen: Set<string> | null = null;

function render() {
  const active = list.filter((d) => d.status !== "cleared"), incoming = active.filter((d) => d.status === "pending");
  $("u-incoming").innerHTML = incoming.map((d) => `<div class="u-alert" data-id="${esc(d.id)}">
      <div class="u-alert-h">New dispatch</div>
      <div class="u-target">${esc(d.target)}</div>
      <div class="muted">${d.kind === "road" ? "Road closure" : "Building at risk"} · ${esc(d.unit)} · sent ${et(d.created)} ET</div>
      <button class="btn u-big" data-from="pending">Acknowledge</button></div>`).join("");
  const rest = active.filter((d) => d.status !== "pending");
  $("u-active").innerHTML = rest.length || incoming.length
    ? rest.map((d) => `<li data-id="${esc(d.id)}"><span><b>${esc(d.target)}</b><br><span class="muted small">${esc(d.unit)} · ${d.status.replace("-", " ")} since ${et(d.history.at(-1)!.at)} ET</span></span>
        <button class="btn small" data-from="${d.status}">${NEXT_LABEL[d.status]}</button></li>`).join("")
    : `<li class="muted">No active dispatches. Waiting…</li>`;
  $("u-cleared").innerHTML = list.filter((d) => d.status === "cleared").slice(0, 10)
    .map((d) => `<li class="muted small">${esc(d.target)} · ${esc(d.unit)} · cleared ${et(d.history.at(-1)!.at)} ET</li>`).join("");
  $("u-token").hidden = !!token();
}

async function tick() {
  try {
    list = await (await fetch("/api/dispatch")).json();
    const fresh = list.some((d) => d.status === "pending" && seen && !seen.has(d.id));
    seen = new Set(list.map((d) => d.id));
    if (fresh) beep();
    render();
  } catch { /* keep the last known state on screen */ }
}

document.body.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement, from = t.dataset.from, id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!from || !id) return;
  if (!token()) return void ($("u-token").hidden = false);
  const r = await fetch(`/api/dispatch/${id}/advance`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": token() }, body: JSON.stringify({ from }) });
  if (r.status === 401) { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
  await tick();   // a 409 means the admin moved it first; the reload shows where it is
});
$("u-token-save").onclick = () => {
  try { sessionStorage.setItem(KEY, $<HTMLInputElement>("u-token-in").value.trim()); } catch { /* storage blocked */ }
  render();
};

void tick();
setInterval(tick, 4000);
