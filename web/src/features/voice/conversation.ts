/**
 * Full spoken conversation with the HackRU-26 Flood Guide through ElevenLabs Agents: natural speech, follow-ups, interruptions.
 * The agent only talks. Every fact and every route comes from the app through these client tools,
 * the same rule as the rest of the app (code picks the route, AI phrases it).
 */
import { Conversation, type VoiceConversation } from "@elevenlabs/client";
import type { Plan } from "../../lib/route";

type Found = { name: string; lon: number; lat: number; campus: string | null; source: string };

export type ConversationCtx = {
  facts: () => Record<string, unknown>;
  placeNames: () => string[];
  roadNames: () => string[];
  setStartByName: (name: string) => boolean;
  setStartAt: (lon: number, lat: number) => void;
  setStart: (s: { name: string; lon: number; lat: number }) => void;
  inArea: (lon: number, lat: number) => boolean;
  hasStart: () => boolean;
  guide: () => Promise<{ script: string; plan: Plan | null }>;
  roadFacts: (road: string) => Record<string, unknown> | null;
};

const json = (o: unknown) => JSON.stringify(o);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const FILLER = new Set(["the", "a", "at", "hall", "building", "center", "centre", "rutgers", "university", "street", "road", "avenue", "st", "rd", "ave"]);

/** Names sharing the most words with what the user said; exact substring matches first. */
function match(query: string, names: string[], max = 5) {
  const q = query.toLowerCase().trim(), qw = new Set(words(query).filter((w) => !FILLER.has(w)));
  return names
    .map((n) => ({ n, score: (n.toLowerCase().includes(q) ? 10 : 0) + words(n).filter((w) => qw.has(w)).length }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.n);
}

export class AgentConversation {
  private conv: VoiceConversation | null = null;
  /** Places returned by find_place this conversation, by lowercase name. */
  private found = new Map<string, Found>();
  active = false;
  private mode: "speaking" | "listening" = "listening";
  // Walking guidance: GPS is watched once a route is planned, and the agent is told when to speak.
  private plan: Plan | null = null;
  private stepIdx = 0;
  private watch: number | null = null;
  private pending: string | null = null;     // latest navigation update, held while the agent is talking
  private fromGps = false;                   // location came from GPS, so the route starts where they really are
  private ending = false;

  constructor(private ctx: ConversationCtx, private log: (line: string) => void, private onState: (s: string) => void) {}

  /** Tell the agent something it must act on now (it was not said by the user). Waits until the agent stops talking. */
  private notify(text: string) {
    this.pending = `NAVIGATION UPDATE: ${text}`;
    this.flush();
  }
  private flush() {
    if (!this.conv || !this.pending || this.mode !== "listening") return;
    this.log(`📍 ${this.pending.replace("NAVIGATION UPDATE: ", "")}`);
    this.conv.sendUserMessage(this.pending);
    this.pending = null;
  }

  private stopFollowing() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
  }

  /**
   * While they walk: say each step on arrival at its turn, say when they've arrived, re-plan if they leave the route.
   * A route from a named place is only followed if GPS confirms they are actually near its start.
   */
  private follow(plan: Plan) {
    this.stopFollowing();
    this.plan = plan;
    this.stepIdx = 0;
    if (!navigator.geolocation) return;
    let confirmed = this.fromGps;
    const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 84500, (a[1] - b[1]) * 111000);
    this.watch = navigator.geolocation.watchPosition((p) => {
      const plan = this.plan;
      if (!plan || !this.conv) return;
      const here: [number, number] = [p.coords.longitude, p.coords.latitude];
      if (!confirmed) {
        if (m(here, plan.coords[0]) > 75) return this.stopFollowing();   // not where they said: don't guess
        confirmed = true;
      }
      const end = plan.coords[plan.coords.length - 1];
      if (m(here, end) < 25) {
        this.stopFollowing();
        return this.notify(`They have arrived at ${plan.dest.name}. Tell them they made it and to go inside and stay there unless they see water coming in.`);
      }
      const next = plan.steps[this.stepIdx + 1];
      if (next && m(here, next.at) < 20) {
        this.stepIdx++;
        return this.notify(`They reached step ${this.stepIdx + 1} of ${plan.steps.length}. Tell them now, in one short sentence: "${next.say}"`);
      }
      const off = Math.min(...plan.coords.map((c) => m(here, c)));
      if (off > 50) {
        this.stopFollowing();
        this.plan = null;
        this.ctx.setStartAt(here[0], here[1]);
        this.fromGps = true;
        this.notify(`They are about ${Math.round(off)} meters off the route. Tell them briefly, call plan_route again from where they are now, and give the new first step.`);
      }
    }, undefined, { enableHighAccuracy: true, maximumAge: 5000 });
  }

  /** True when the server has an ElevenLabs agent configured. */
  static async available() {
    try { return (await fetch("/api/agent/session", { method: "GET" })).ok; } catch { return false; }
  }

  private tools() {
    const c = this.ctx;
    return {
      get_situation: () => json(c.facts()),
      // All Rutgers buildings, campus names, nicknames (LSM, ARC…) and OpenStreetMap, searched on the server.
      find_place: async ({ query }: { query: string }) => {
        const r = await fetch(`/api/places/search?q=${encodeURIComponent(String(query ?? ""))}`).then((x) => x.json()).catch(() => ({ matches: [] }));
        const matches = (r.matches ?? []) as Found[];
        matches.forEach((p) => this.found.set(p.name.toLowerCase(), p));
        if (!matches.length) return json({ matches: [], note: "No place with that name in the area. Ask them for a nearby building or street, or offer to use their location." });
        return json({ matches: matches.map((p) => ({ name: p.name, campus: p.campus })), ...(r.campus_only ? { campus_only: true, note: r.note } : {}) });
      },
      set_location: ({ place }: { place: string }) => {
        const key = String(place ?? "").toLowerCase();
        const p = this.found.get(key) ?? [...this.found.values()].find((x) => x.name.toLowerCase().includes(key));
        this.fromGps = false;
        if (p) { c.setStart({ name: p.name, lon: p.lon, lat: p.lat }); return json({ ok: true, location: p.name }); }
        const known = c.placeNames().find((n) => n.toLowerCase() === key) ?? match(String(place ?? ""), c.placeNames(), 1)[0];
        return json(known && c.setStartByName(known) ? { ok: true, location: known } : { ok: false, note: "Unknown place. Use find_place first." });
      },
      use_my_location: () => new Promise<string>((res) => {
        if (!navigator.geolocation) return res(json({ ok: false, note: "This device cannot share its location. Ask which building they are in." }));
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const { longitude: lon, latitude: lat } = p.coords;
            if (!c.inArea(lon, lat)) return res(json({ ok: false, note: "They are outside the area this app covers (Rutgers New Brunswick)." }));
            c.setStartAt(lon, lat);
            this.fromGps = true;
            res(json({ ok: true, location: "their GPS position", accuracy_m: Math.round(p.coords.accuracy) }));
          },
          () => res(json({ ok: false, note: "Location permission was denied or unavailable. Ask which building they are in." })),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      }),
      plan_route: async () => {
        if (!c.hasStart()) return json({ ok: false, note: "Location not set yet. Ask where they are first." });
        const { plan } = await c.guide();
        this.stopFollowing();
        if (!plan) return json({ ok: true, shelter_in_place: true, instruction: "Flood water is predicted where they are. Do not walk or drive through it. Move to the highest floor and call 9 1 1." });
        if (plan.meters < 60) return json({ ok: true, already_there: true, destination: plan.dest.name,
          instruction: `They are already at ${plan.dest.name}, a gathering point on high ground predicted to stay dry. Tell them to stay there unless they see water coming in. It is not an official shelter.` });
        this.follow(plan);
        return json({ ok: true, destination: plan.dest.name, minutes: Math.round(plan.minutes), meters: Math.round(plan.meters),
          avoids: plan.avoid, steps: plan.steps.map((s) => s.say), note: "Gathering point on high ground, not an official shelter.",
          walking_guidance: "The phone will send NAVIGATION UPDATE messages as they reach each turn, so they don't have to keep asking." });
      },
      road_status: ({ road }: { road: string }) => {
        const name = c.roadNames().find((n) => n.toLowerCase() === String(road ?? "").toLowerCase()) ?? match(String(road ?? ""), c.roadNames(), 1)[0];
        const f = name && c.roadFacts(name);
        return json(f || { found: false, note: "No road with that name in the area." });
      },
      // Saying goodbye ends the call: no hunting for the button. Waits for the agent to finish its goodbye first.
      end_conversation: () => {
        if (this.ending) return;
        this.ending = true;
        const started = Date.now();
        const wait = setInterval(() => {
          if ((this.mode === "listening" && Date.now() - started > 1200) || Date.now() - started > 8000) { clearInterval(wait); void this.stop(); }
        }, 250);
      },
    };
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.ending = false;
    this.mode = "listening";
    this.onState("Connecting…");
    try {
      const r = await fetch("/api/agent/session");
      if (!r.ok) throw new Error((await r.json()).error ?? `status ${r.status}`);
      const { signedUrl } = await r.json();
      this.conv = await Conversation.startSession({
        signedUrl,
        clientTools: this.tools(),
        onConnect: () => this.onState("Listening. Just talk."),
        onDisconnect: () => { this.stopFollowing(); this.active = false; this.conv = null; this.onState("Conversation ended."); },
        onModeChange: ({ mode }) => {
          this.mode = mode === "speaking" ? "speaking" : "listening";
          this.onState(mode === "speaking" ? "Flood Guide is speaking…" : "Listening. Just talk.");
          this.flush();
        },
        onMessage: ({ message, role }) => {
          if (role === "user" && message.startsWith("NAVIGATION UPDATE")) return;   // already logged as 📍
          this.log(`${role === "user" ? "🗣️ You" : "🔊 Flood Guide"}: ${message}`);
        },
        onError: (message) => this.log(`⚠️ ${message}`),
      }) as VoiceConversation;
    } catch (e) {
      this.active = false;
      this.onState("");
      throw e;
    }
  }

  async stop() {
    this.stopFollowing();
    this.active = false;
    const conv = this.conv;
    this.conv = null;
    await conv?.endSession();
    this.onState("Conversation ended.");
  }
}
