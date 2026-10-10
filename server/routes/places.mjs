// Place search for "where are you?": app landmarks and gathering points, all 324 located Rutgers buildings,
// campus names and common nicknames, then OpenStreetMap (Nominatim) inside the map area for anything else.
import fs from "node:fs";
import path from "node:path";
import { UA, cached, send } from "../lib/http.mjs";

// Campus names point at that campus's student center (a gathering point).
const CAMPUSES = {
  busch: "Busch Student Center", livingston: "Livingston Student Center", "college ave": "College Avenue Student Center",
  "college avenue": "College Avenue Student Center", cook: "Cook Student Center", douglass: "Douglass Student Center",
};
// What students actually call buildings -> a name OpenStreetMap or the Rutgers list knows.
const NICKNAMES = {
  lsm: "Library of Science & Medicine", "science library": "Library of Science & Medicine",
  arc: "Allison Road Classroom Building", serc: "Science and Engineering Resource Center",
  bsc: "Busch Student Center", lsc: "Livingston Student Center", casc: "College Avenue Student Center",
  "the rac": "Jersey Mike's Arena", rac: "Jersey Mike's Arena", werblin: "Sonny A. Werblin Recreation Center",
  "alexander library": "Archibald S. Alexander Library", alex: "Archibald S. Alexander Library",
  "the yard": "College Avenue Student Center", brower: "Brower Commons", neilson: "Neilson Dining Hall",
};
const CAMPUS_OF = { CAC: "College Avenue", BU: "Busch", "BU-HS": "Busch", LV: "Livingston", CD: "Cook/Douglass", "DNB-HS": "Downtown New Brunswick", DNB: "Downtown New Brunswick" };

const words = (s) => String(s).toLowerCase().replace(/&/g, " and ").match(/[a-z0-9]+/g) ?? [];
const FILLER = new Set(["the", "a", "of", "and", "at", "hall", "building", "bldg", "center", "rutgers", "university", "campus"]);

export default function register(api, ctx) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ctx.webData, f), "utf8"));
  const [w, s, e, n] = read("grid.json").bounds;
  const index = [];
  const add = (name, lon, lat, campus, source, also = "") => name && lon && index.push({ name, lon, lat, campus, source, key: words(`${name} ${also}`) });
  for (const p of read("starts.json")) add(p.name, p.lon, p.lat, p.campus, "landmark");
  for (const p of read("places.json")) if (p.kind === "gather") add(p.name, p.lon, p.lat, p.campus, "gathering point");
  for (const b of read("rutgers_buildings.json")) if (!index.some((x) => x.name === b.name)) add(b.name, b.lon, b.lat, CAMPUS_OF[b.site] ?? null, "rutgers building", b.alias);

  function local(q) {
    const qw = words(q).filter((x) => !FILLER.has(x)), ql = q.toLowerCase();
    if (!qw.length) return [];
    return index
      .map((p) => ({ p, hit: qw.filter((x) => p.key.includes(x)).length, exact: p.name.toLowerCase() === ql }))
      .filter((x) => x.exact || x.hit === qw.length || (qw.length > 2 && x.hit >= qw.length - 1))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.hit - a.hit || a.p.name.length - b.p.name.length)
      .slice(0, 5).map((x) => x.p);
  }

  async function osm(q) {
    const tries = [...new Set([q, q.replace(/\band\b/gi, "&"), `${q} Rutgers`])];
    for (const t of tries) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=3&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(t)}`;
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      // Keep only results whose name shares a real word with the question (OSM sometimes returns a nearby address instead).
      const want = new Set(words(q).filter((x) => !FILLER.has(x)));
      const hits = (await r.json())
        .map((x) => ({ name: x.display_name.split(",")[0].trim(), lon: +x.lon, lat: +x.lat, campus: null, source: "openstreetmap" }))
        .filter((x) => words(x.name).some((wd) => want.has(wd)));
      if (hits.length) return hits;
    }
    return [];
  }

  api.get("/api/places/search", async (req, res, m, url) => {
    const raw = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!raw) return send(res, 400, { error: "q required" });
    const q = raw.toLowerCase().replace(/^(the|i'?m at|at|in|near)\s+/g, "");
    const campus = CAMPUSES[q.replace(/\s*campus$/, "")];
    if (campus) {
      const c = index.find((p) => p.name === campus);
      return send(res, 200, { campus_only: true, note: `"${raw}" is a whole campus. Ask which building they are in. If they don't know, use ${campus}.`, matches: c ? [c] : [] });
    }
    const name = NICKNAMES[q] ?? raw;
    let matches = local(name);
    if (!matches.length) matches = await cached(`osm:${name.toLowerCase()}`, 86_400_000, () => osm(name));
    send(res, 200, { matches: matches.map(({ key, ...p }) => p) });
  });
}
