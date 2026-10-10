/**
 * Hands-free voice assistant for blind and low-vision users.
 * One key press or tap starts it (browsers require a gesture for audio and microphone); after that it
 * briefs, listens continuously, answers, guides, and announces each step while walking.
 * The AI only understands speech and phrases answers from app facts; routes and safety scripts come from code.
 */
import type { Plan } from "../../lib/route";

type Ctx = {
  facts: () => Record<string, unknown>;
  placeNames: () => string[];
  roadNames: () => string[];
  setStartByName: (name: string) => boolean;
  setStartAt: (lon: number, lat: number) => void;
  inArea: (lon: number, lat: number) => boolean;
  guide: () => Promise<{ script: string; plan: Plan | null }>;
  roadFacts: (road: string) => Record<string, unknown> | null;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
};

const RUPD_SPOKEN = "7 3 2, 9 3 2, 7 1 1 1";
const EMERGENCY = `Call 9 1 1 now. If water is around you, do not walk through it. Move to the highest floor you can reach and wait for help. Rutgers police: ${RUPD_SPOKEN}.`;
const HELP = "You can say: where should I go. I'm at, and a building name. Use my location. What's happening with the river. Is a road flooded, for example River Road. Next step. Repeat. Or stop. If you are in danger, say emergency.";

type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export class VoiceAssistant {
  active = false;
  private rec: SR | null = null;
  private busy = false;
  private last = "";
  private plan: Plan | null = null;
  private stepIdx = 0;
  private watch: number | null = null;
  private log: (s: string) => void;

  constructor(private ctx: Ctx, log: (s: string) => void) { this.log = log; }

  private async say(text: string) {
    this.last = text;
    this.busy = true;
    this.rec?.abort();                       // don't transcribe our own voice
    await this.ctx.speak(text);
    this.busy = false;
    this.listen();
  }

  async start() {
    if (this.active) return;
    this.active = true;
    const Rec = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
    if (Rec) {
      this.rec = new Rec();
      this.rec.lang = "en-US";
      this.rec.continuous = false;
      this.rec.interimResults = false;
      this.rec.onresult = (e) => { const t = e.results[0]?.[0]?.transcript?.trim(); if (t) void this.handle(t); };
      this.rec.onend = () => { if (this.active && !this.busy) setTimeout(() => this.listen(), 250); };
      this.rec.onerror = (e) => { if (e.error === "not-allowed") { this.rec = null; void this.say("I can't use the microphone. Press space to hear a briefing, G to be guided, R to repeat, or Escape to stop."); } };
    }
    const brief = await this.explain("Give me a short safety briefing right now.", "Voice assistant is on.");
    await this.say(`Voice assistant on. ${brief} ${this.rec ? "Ask me anything, or say help." : "Voice input isn't available in this browser: press space for a briefing, G to be guided, R to repeat."}`);
  }

  stop() {
    this.active = false;
    this.rec?.abort();
    this.ctx.stopSpeaking();
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    this.log("Voice assistant off.");
  }

  private listen() {
    if (!this.active || this.busy || !this.rec) return;
    try { this.rec.start(); this.log("Listening…"); } catch { /* already listening */ }
  }

  /** Keyboard fallback for users without a working microphone. */
  key(k: string) {
    if (!this.active) return;
    if (k === " ") void this.handle("what's happening with the river");
    else if (k === "g") void this.handle("where should I go");
    else if (k === "r") void this.say(this.last || HELP);
    else if (k === "n") void this.handle("next step");
  }

  private async explain(question: string, fallback: string, facts = this.ctx.facts()) {
    try {
      const r = await fetch("/api/assist/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, facts, fallback }) }).then((x) => x.json());
      return String(r.answer || fallback);
    } catch { return fallback; }
  }

  async handle(text: string) {
    this.log(`You said: “${text}”`);
    let it: { intent: string; place?: string | null; road?: string | null };
    try {
      it = await fetch("/api/assist/intent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, places: this.ctx.placeNames(), roads: this.ctx.roadNames() }) }).then((x) => x.json());
    } catch { it = { intent: "other" }; }
    switch (it.intent) {
      case "emergency": return this.say(EMERGENCY);                                   // fixed text, never AI
      case "stop": this.ctx.stopSpeaking(); return this.say("Okay.");
      case "repeat": return this.say(this.last || HELP);
      case "help": return this.say(HELP);
      case "next_step": return this.nextStep();
      case "use_my_location": return this.locateAndGuide();
      case "road_status": {
        const f = it.road ? this.ctx.roadFacts(it.road) : null;
        if (!f) return this.say("I couldn't find that road. Try saying its full name, like River Road.");
        return this.say(await this.explain(`Is ${it.road} flooded or safe to walk?`, String(f.summary), { ...this.ctx.facts(), road: f }));
      }
      case "set_location":
      case "where_to_go":
        if (it.place && !this.ctx.setStartByName(it.place)) return this.say(`I couldn't find ${it.place}.`);
        if (!it.place && !this.ctx.facts().you_are_at) return this.say("Where are you? Say a building name, like Scott Hall, or say use my location.");
        return this.guide();
      default:
        return this.say(await this.explain(text, "I'm not sure. Say help to hear what you can ask."));
    }
  }

  private async locateAndGuide() {
    await this.say("Finding your location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!this.ctx.inArea(p.coords.longitude, p.coords.latitude)) { void this.say("You seem to be outside the New Brunswick area I cover. Say a building name instead."); return; }
        this.ctx.setStartAt(p.coords.longitude, p.coords.latitude);
        void this.guide(true);
      },
      () => void this.say("I couldn't get your location. Say a building name instead, like Scott Hall."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  private async guide(follow = false) {
    const { script, plan } = await this.ctx.guide();
    this.plan = plan;
    this.stepIdx = 0;
    await this.say(`${script}${plan ? " Say next step for each direction, or repeat." : ""}`);
    if (plan && follow) this.follow();
  }

  private nextStep() {
    if (!this.plan) return this.say("There's no route yet. Say where should I go.");
    this.stepIdx = Math.min(this.stepIdx + 1, this.plan.steps.length - 1);
    return this.say(`Step ${this.stepIdx + 1} of ${this.plan.steps.length}. ${this.plan.steps[this.stepIdx].say}`);
  }

  /** While walking: announce each step on arrival, re-plan if off route. */
  private follow() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = navigator.geolocation.watchPosition((p) => {
      if (!this.plan || this.busy) return;
      const here: [number, number] = [p.coords.longitude, p.coords.latitude];
      const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 84500, (a[1] - b[1]) * 111000);
      const next = this.plan.steps[this.stepIdx + 1];
      if (next && m(here, next.at) < 20) { this.stepIdx++; void this.say(next.say); return; }
      const off = Math.min(...this.plan.coords.map((c) => m(here, c as [number, number])));
      if (off > 50) { this.ctx.setStartAt(here[0], here[1]); void this.say("You're off the route. Re-routing.").then(() => this.guide(true)); }
    }, undefined, { enableHighAccuracy: true });
  }
}
