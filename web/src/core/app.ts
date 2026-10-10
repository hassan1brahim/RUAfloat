/**
 * App shell: the map, the layout slots, the river-level update loop and a registry of features.
 * Features never import each other; they share things through typed services (see `Services`).
 */
import maplibregl, { type Map as MLMap, type MapMouseEvent } from "maplibre-gl";
import { BASE_FT, riseDmOf, $ } from "./util";

export type Mode = "live" | "ida" | "whatif";
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

type CardOpts = { col: "left" | "right"; id: string; title: string; html?: string; order: number; hidden?: boolean; extraTitle?: string };

export class App {
  map!: MLMap;
  readonly state = { mode: "live" as Mode, stageFt: BASE_FT };
  readonly params = new URLSearchParams(location.search);
  private svc: Partial<Services> = {};
  private picking: ((pt: Pt) => void) | null = null;
  private pending = 0;
  private started = false;   // no redraws until every feature has initialised
  private defaultHint = "Click a road for its status";

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
    el.dataset.order = String(o.order);
    el.hidden = !!o.hidden;
    el.innerHTML = `<h2>${o.title}${o.extraTitle ?? ""}</h2>${o.html ?? ""}`;
    const col = $(o.col === "left" ? "col-left" : "col-right");
    const after = [...col.children].find((c) => Number((c as HTMLElement).dataset.order) > o.order);
    col.insertBefore(el, after ?? null);
    return el;
  }

  /** A checkbox in the map's layer panel. */
  toggle(label: string, layerIds: string[], on = true) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} /> ${label}`;
    l.querySelector("input")!.onchange = (e) => {
      const v = (e.target as HTMLInputElement).checked ? "visible" : "none";
      layerIds.forEach((id) => this.map.getLayer(id) && this.map.setLayoutProperty(id, "visibility", v));
    };
    $("map-layers").append(l);
    if (!on) layerIds.forEach((id) => this.map.getLayer(id) && this.map.setLayoutProperty(id, "visibility", "none"));
  }

  legend(html: string) { $("legend").insertAdjacentHTML("beforeend", html); }
  headerItem(el: HTMLElement) { $("top-status").append(el); }

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
    for (const f of this.features) await f.ready?.(this);
    this.update();
    if (import.meta.env.DEV) (window as unknown as { __rudc: object }).__rudc = { app: this, map: this.map };
    (window as unknown as { __ready: boolean }).__ready = true;
  }
}
