/**
 * Speech output: ElevenLabs via the server (/api/tts), browser speech as fallback.
 * Resolves when speaking ends.
 * Screen-reader mode (VoiceOver, TalkBack, NVDA users): the app plays no audio of its own and hands each line to the
 * screen reader through an aria-live region instead, so it is read in the user's own voice and speed, never twice.
 */
let audio: HTMLAudioElement | null = null;
const listeners: ((text: string, voice: string) => void)[] = [];
const SR_KEY = "hackru-26-screen-reader";

export function screenReaderMode(): boolean {
  if (srOverride !== null) return srOverride;   // set this page, even when storage is blocked
  if (new URLSearchParams(location.search).get("sr") === "1") return true;
  try { return localStorage.getItem(SR_KEY) === "1"; } catch { return false; }
}
export function setScreenReaderMode(on: boolean) {
  try { localStorage.setItem(SR_KEY, on ? "1" : "0"); } catch { /* private mode: setting lasts for this page only */ }
  srOverride = on;
}
let srOverride: boolean | null = null;
const srOn = () => screenReaderMode();

/** Speak through the screen reader only (no app audio), e.g. for status updates. */
export function announce(text: string) {
  const el = liveRegion();
  el.textContent = "";
  setTimeout(() => (el.textContent = text), 60);   // clearing first makes repeated text announce again (timers, unlike animation frames, also run in background tabs)
}

/** Called after each spoken line, e.g. to show it in a conversation log. */
export function onSpeak(cb: (text: string, voice: string) => void) { listeners.push(cb); }

function liveRegion() {
  let el = document.getElementById("sr-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "sr-live";
    el.className = "sr-only";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");   // polite: never cuts off what the screen reader is already reading, e.g. the route it just focused
    el.setAttribute("aria-atomic", "true");
    document.body.prepend(el);
  }
  return el;
}

export function stopSpeaking() { audio?.pause(); speechSynthesis.cancel(); }

export async function speak(text: string): Promise<void> {
  if (!text) return;
  stopSpeaking();
  if (srOn()) {
    announce(text);
    listeners.forEach((cb) => cb(text, "screen reader"));
    // Rough reading time at a typical screen-reader rate, so callers that wait for speech to end still pace correctly.
    await new Promise((res) => setTimeout(res, Math.max(1500, text.split(/\s+/).length * 330)));
    return;
  }
  try {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error((await r.json()).error);
    audio = new Audio(URL.createObjectURL(await r.blob()));
    listeners.forEach((cb) => cb(text, "ElevenLabs"));
    await new Promise<void>((res) => { audio!.onended = () => res(); audio!.onpause = () => res(); audio!.play().catch(() => res()); });
  } catch (e) {
    listeners.forEach((cb) => cb(text, `browser fallback (${String((e as Error).message || e).slice(0, 60)})`));
    await new Promise<void>((res) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => res(); u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }
}
