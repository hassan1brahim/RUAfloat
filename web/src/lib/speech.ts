/**
 * Speech output: ElevenLabs via the server (/api/tts), browser speech as fallback.
 * Resolves when speaking ends. Every line is mirrored to an aria-live region for screen readers.
 */
let audio: HTMLAudioElement | null = null;
const listeners: ((text: string, voice: string) => void)[] = [];

/** Called after each spoken line, e.g. to show it in a conversation log. */
export function onSpeak(cb: (text: string, voice: string) => void) { listeners.push(cb); }

function liveRegion() {
  let el = document.getElementById("sr-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "sr-live";
    el.className = "sr-only";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.prepend(el);
  }
  return el;
}

export function stopSpeaking() { audio?.pause(); speechSynthesis.cancel(); }

export async function speak(text: string): Promise<void> {
  if (!text) return;
  stopSpeaking();
  liveRegion().textContent = text;
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
