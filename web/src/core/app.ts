/**
 * App shell: the map, the layout slots, the river-level update loop and a registry of features.
 * Features never import each other; they share things through typed services (see `Services`).
 */
import maplibregl, { type Map as MLMap, type MapMouseEvent } from "maplibre-gl";
import { BASE_FT, riseDmOf, $ } from "./util";

export type Mode = "live" | "ida" | "whatif";
export type View = "student" | "admin";
export type Pt = { lon: number; lat: number };

/** Each feature adds the services it provides via `declare module "../../core/app"`. */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Services {}

export interface Feature {
  id: string;
  init(app: App): void | Promise<void>;
  /** After everything has initialised (e.g. apply URL parameters). */
  ready?(app: App): void | Promise<void>;
  /** Runs whenever the river level or observations change, in registration order. */
  update?(app: App): void;
  /** Facts the voice assistant may speak from. */
  facts?(app: App): Record<string, unknown>;
  /** Return true when handled. Higher `clickPriority` is asked first (markers before outlines before roads). */
  click?(app: App, pt: Pt, ev: MapMouseEvent): boolean;
  clickPriority?: number;
}

/** `col` places the card in Admin view, `student` in Student view; a card without one is not shown in that view. */
/** Which views show a layer checkbox or legend entry. */
export type Views = View | "both";
/** `key` links legend entries to the checkbox. */
type LayerOpts = { views?: Views; key?: string };
type CardOpts = { col?: "left" | "right"; student?: "left" | "right"; studentOrder?: number; id: string; title: string; html?: string; order: number; hidden?: boolean; extraTitle?: string };

export class App {
  map!: MLMap;
  readonly params = new URLSearchParams(location.search);
  readonly state = {
    mode: "live" as Mode, stageFt: BASE_FT,
    view: (this.params.get("view") === "admin" ? "admin" : "student") as View,
    /** Student accessibility options (set by the student feature, read by the guide). */
    access: { noStairs: false, readAloud: true },
  };
  private svc: Partial<Services> = {};
  private picking: ((pt: Pt) => void) | null = null;
  private pending = 0;
  private started = false;   // no redraws until every feature has initialised
  private defaultHint = "Click a road for its status";
  private keyOn = new Map<string, boolean>();

  constructor(private features: Feature[]) {}

  provide<K extends keyof Services>(key: K, value: Services[K]) { this.svc[key] = value; }
  has<K extends keyof Services>(key: K) { return this.svc[key] !== undefined; }
  get<K extends keyof Services>(key: K): Services[K] {
    const v = this.svc[key];
    if (v === undefined) throw new Error(`service "${String(key)}" not available`);
    return v as Services[K];
  }
  maybe<K extends keyof Services>(key: K): Services[K] | undefined { return this.svc[key] as Services[K] | undefined; }

  rise() { return riseDmOf(this.state.stageFt); }

  /** Set the Bound Brook level (ft); everything redraws on the next frame. */
  setStage(ft: number) {
    this.state.stageFt = ft;
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.update(); });
  }
  refresh() { this.setStage(this.state.stageFt); }
  update() { if (this.started) for (const f of this.features) f.update?.(this); }

  facts() { return Object.assign({}, ...this.features.map((f) => f.facts?.(this) ?? {})); }

  /** A panel in the left or right column; `order` keeps the layout stable whatever order features load in. */
  card(o: CardOpts): HTMLElement {
    const el = document.createElement("section");
    el.className = "card";
    el.id = o.id;
    el.dataset.colAdmin = o.col ?? "";
    el.dataset.colStudent = o.student ?? "";
    el.dataset.orderAdmin = String(o.order);
    el.dataset.orderStudent = String(o.studentOrder ?? o.order);
    el.hidden = !!o.hidden;
    el.innerHTML = `<h2>${o.title}${o.extraTitle ?? ""}</h2>${o.html ?? ""}`;
    this.place(el);
    return el;
  }

  /** Put a card in its column for the current view, or hide it if that view doesn't show it. */
  private place(el: HTMLElement) {
    const student = this.state.view === "student";
    const own = student ? el.dataset.colStudent : el.dataset.colAdmin;
    // A card this view doesn't show stays in the page (features keep updating it), just hidden.
    const col = own || el.dataset.colAdmin || el.dataset.colStudent;
    el.classList.toggle("off-view", !own);
    const order = Number(student && own ? el.dataset.orderStudent : el.dataset.orderAdmin);
    el.dataset.order = String(order);
    const parent = $(col === "left" ? "col-left" : "col-right");
    const after = [...parent.children].find((c) => c !== el && Number((c as HTMLElement).dataset.order) > order);
    parent.insertBefore(el, after ?? null);
  }

  setView(v: View) {
    this.state.view = v;
    document.body.dataset.view = v;
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => {
      b.classList.toggle("on", b.dataset.view === v);
      b.setAttribute("aria-pressed", String(b.dataset.view === v));
    });
    document.querySelectorAll<HTMLElement>(".col > .card").forEach((el) => this.place(el));
    this.map?.resize();
    this.update();
  }

  /** A checkbox in the map's layer panel, listed under its `group` heading. Returns a setter for changing it from code. */
  check(label: string, on: boolean, onChange: (on: boolean) => void, group = "Flooding", o: LayerOpts = {}) {
    const panel = $("map-layers");
    const views = o.views ?? "both";
    const head = panel.querySelector<HTMLElement>(`.layers-h[data-group="${group}"]`);
    // the heading shows in every view that has at least one of its checkboxes
    if (!head) panel.insertAdjacentHTML("beforeend", `<div class="layers-h" data-group="${group}" data-views="${views}">${group}</div>`);
    else if (head.dataset.views !== views) head.dataset.views = "both";
    const l = document.createElement("label");
    l.dataset.group = group;
    l.dataset.views = views;
    l.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} /> ${label}`;
    const input = l.querySelector("input")!;
    const apply = (v: boolean) => { onChange(v); if (o.key) this.legendKey(o.key, v); };
    input.onchange = () => apply(input.checked);
    const inGroup = panel.querySelectorAll(`[data-group="${group}"]`);
    inGroup[inGroup.length - 1].after(l);
    if (o.key) this.legendKey(o.key, on);
    return (v: boolean) => { input.checked = v; apply(v); };
  }

  /** A checkbox that shows or hides map layers. */
  toggle(label: string, layerIds: string[], on = true, group = "Flooding", o: LayerOpts = {}) {
    const set = (v: boolean) => layerIds.forEach((id) => this.map.getLayer(id) && this.map.setLayoutProperty(id, "visibility", v ? "visible" : "none"));
    const setter = this.check(label, on, set, group, o);
    if (!on) set(false);
    return setter;
  }

  /** Legend entries; `key` hides them while that layer is off. */
  legend(html: string, o: LayerOpts = {}) {
    const off = o.key != null && this.keyOn.get(o.key) === false;
    $("legend").insertAdjacentHTML("beforeend", `<div class="lg" data-views="${o.views ?? "both"}"${o.key ? ` data-key="${o.key}"` : ""}${off ? " hidden" : ""}>${html}</div>`);
  }
  private legendKey(key: string, on: boolean) {
    this.keyOn.set(key, on);
    document.querySelectorAll<HTMLElement>(`#legend .lg[data-key="${key}"]`).forEach((el) => (el.hidden = !on));
  }
  /** Right side of the header: the "Right now" block. */
  headerNow(el: HTMLElement) { $("top-now").append(el); }
  /** Under the HackRU-26 title (the live / what-if indicator). */
  heroStatus(el: HTMLElement) { $("hero-status").append(el); }
  /** A floating card on the map, like the legend. */
  mapOverlay(el: HTMLElement) { $("mapwrap").append(el); }

  hint(text?: string) { $("map-hint").textContent = text ?? this.defaultHint; }
  setDefaultHint(text: string) { this.defaultHint = text; this.hint(); }

  /** Next map click goes to `cb` instead of the features. */
  pick(prompt: string, cb: (pt: Pt) => void) {
    this.picking = cb;
    this.hint(prompt);
    this.map.getCanvas().style.cursor = "crosshair";
  }

  popup(pt: Pt, html: string) {
    new maplibregl.Popup({ closeButton: true, maxWidth: "340px" }).setLngLat([pt.lon, pt.lat]).setHTML(html).addTo(this.map);
  }

  async start(createMap: () => Promise<MLMap>) {
    document.body.dataset.view = this.state.view;
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => (b.onclick = () => this.setView(b.dataset.view as View)));
    this.map = await createMap();
    for (const f of this.features) await f.init(this);
    this.map.on("click", (ev) => {
      const pt = { lon: ev.lngLat.lng, lat: ev.lngLat.lat };
      if (this.picking) {
        const cb = this.picking;
        this.picking = null;
        this.map.getCanvas().style.cursor = "";
        this.hint();
        return cb(pt);
      }
      const byPriority = [...this.features].sort((a, b) => (b.clickPriority ?? 0) - (a.clickPriority ?? 0));
      for (const f of byPriority) if (f.click?.(this, pt, ev)) return;
    });
    // small screens start with the map overlays folded so they don't cover the flood
    if (matchMedia("(max-width: 1000px)").matches) for (const id of ["layers-box", "legend-box"]) $(id).removeAttribute("open");
    this.started = true;
    this.setView(this.state.view);
    for (const f of this.features) await f.ready?.(this);
    this.update();
    if (import.meta.env.DEV) (window as unknown as { __rudc: object }).__rudc = { app: this, map: this.map };
    (window as unknown as { __ready: boolean }).__ready = true;
  }
}
