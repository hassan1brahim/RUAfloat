// Ground-truth sources: USGS river cameras + Gemini vision, student photo reports. Street sensors live in ../sensors.mjs.
// The model predicts; these observe. Every observation keeps its evidence (image, time, gauge reading).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gemini } from "./gemini.mjs";

import { UA } from "./http.mjs";
/** A client-input error: the server answers 400, not 502. */
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.5-flash-lite";

/**
 * USGS HIVIS cameras on gauges near campus. `ref` is an image of the same camera at a normal level:
 * without it the model over-called a 5 ft (normal) day as "high"; with it, 6 of 6 test images matched the gauge.
 */
export const CAMERAS = [
  { id: "NJ_Raritan_River_at_Manville", lid: "MNVN4", usgs: "01400500", name: "Raritan River at Manville", ref: "NJ_Raritan_River_at_Manville___2024-01-08T17-00-05Z.jpg",
    samples: [{ label: "Jan 10, 2024 major flood (20.0 ft)", file: "NJ_Raritan_River_at_Manville___2024-01-10T17-00-05Z.jpg" }] },
  { id: "NJ_Lawrence_Brook_at_Westons_Mills", lid: "LABN4", usgs: "01405030", name: "Lawrence Brook at Westons Mills", ref: "NJ_Lawrence_Brook_at_Westons_Mills___2026-10-09T17-00-02Z.jpg", samples: [] },
  { id: "NJ_Millstone_River_at_Blackwells_Mills", lid: "BKWN4", usgs: "01402000", name: "Millstone River at Blackwells Mills", ref: "NJ_Millstone_River_at_Blackwells_Mills___2026-10-09T17-00-08Z.jpg", samples: [] },
];
const IMG = "https://usgs-nims-images.s3.amazonaws.com/720/";

export function createDetect({ liveDir }) {
  const dataDir = liveDir;
  const photoDir = path.join(dataDir, "report-photos");
  fs.mkdirSync(photoDir, { recursive: true });
  const reportsFile = path.join(dataDir, "reports.json");
  const reports = fs.existsSync(reportsFile) ? JSON.parse(fs.readFileSync(reportsFile, "utf8")) : [];
  const visionCache = new Map();
  let camList = { at: 0, value: null };

  async function getJson(url) {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
  }

  const vision = (parts) => gemini({ parts, json: true, model: VISION_MODEL });

  const b64 = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`camera image ${r.status}: ${url.split("/").pop()}`);
    return Buffer.from(await r.arrayBuffer()).toString("base64");
  };
  const fileTime = (f) => f.split("___")[1].replace(/\.jpg$/, "").replace(/T(\d\d)-(\d\d)-(\d\d)Z/, "T$1:$2:$3Z");

  /* ---------- cameras ---------- */

  async function cameras() {
    if (!camList.value || Date.now() - camList.at > 5 * 60e3) {
      const all = await getJson("https://api.waterdata.usgs.gov/nims/cameras");
      camList = { at: Date.now(), value: new Map(all.map((c) => [c.camId, c])) };
    }
    return Promise.all(CAMERAS.map(async (cam) => {
      const c = camList.value.get(cam.id);
      const file = c ? `${cam.id}___${c.newestImageDT.slice(0, 19).replace(/:/g, "-")}Z.jpg` : null;
      let gauge = null;
      try {
        const g = await getJson(`https://api.water.noaa.gov/nwps/v1/gauges/${cam.lid}`);
        gauge = { stage: g.status.observed.primary, time: g.status.observed.validTime, category: g.status.observed.floodCategory, categories: g.flood.categories };
      } catch { /* gauge optional */ }
      return { id: cam.id, name: cam.name, lid: cam.lid, usgs: cam.usgs, lat: +c?.lat, lon: +c?.lng, file, image: file && IMG + cam.id + "/" + file,
        time: file && fileTime(file), gauge, samples: cam.samples.map((s) => ({ ...s, image: IMG + cam.id + "/" + s.file, time: fileTime(s.file) })) };
    }));
  }

  /** Gauge reading closest to an image time (USGS continuous record). */
  async function gaugeAt(usgs, iso) {
    const t = new Date(iso);
    const from = new Date(t - 20 * 60e3).toISOString().slice(0, 19) + "Z";
    const to = new Date(+t + 20 * 60e3).toISOString().slice(0, 19) + "Z";
    const d = await getJson(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?f=json&monitoring_location_id=USGS-${usgs}&parameter_code=00065&time=${from}/${to}&limit=10`);
    const f = d.features?.[0];
    return f ? { stage: +f.properties.value, time: f.properties.time } : null;
  }

  function expectedFromGauge(stage, cats) {
    const at = (k) => cats?.[k]?.stage > 0 ? cats[k].stage : null;
    if (stage == null) return null;
    if (at("minor") && stage >= at("minor")) return ["out_of_banks"];
    if (at("action") && stage >= at("action")) return ["high_in_banks", "out_of_banks"];
    return ["normal", "high_in_banks"];
  }

  async function checkCamera(id, file) {
    const cam = CAMERAS.find((c) => c.id === id);
    if (!cam) throw bad("unknown camera");
    const list = await cameras();
    const live = list.find((c) => c.id === id);
    file = file || live.file;
    if (!/^[A-Za-z_]+___\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.jpg$/.test(file) || !file.startsWith(cam.id)) throw bad("bad image name");
    if (visionCache.has(file)) return visionCache.get(file);
    const parts = cam.ref
      ? [{ text: `Two images from the SAME fixed USGS river camera (${cam.name}). Image 1 is a REFERENCE at normal river level. Image 2 is the CURRENT image.
Compare image 2 against image 1. Return JSON only: {"image_usable": bool, "water_state": "normal"|"high_in_banks"|"out_of_banks"|"unknown", "change_vs_reference": string, "confidence": number 0-1}.
"normal" = about like the reference. "out_of_banks" = water over ground that is dry in the reference. Too dark or foggy to compare: image_usable=false, water_state="unknown".` },
        { text: "Image 1 (reference, normal level):" }, { inline_data: { mime_type: "image/jpeg", data: await b64(IMG + cam.id + "/" + cam.ref) } },
        { text: "Image 2 (current):" }, { inline_data: { mime_type: "image/jpeg", data: await b64(IMG + cam.id + "/" + file) } }]
      : [{ text: `A fixed USGS river camera image (${cam.name}). No reference image is available, so be conservative.
Return JSON only: {"image_usable": bool, "water_state": "normal"|"high_in_banks"|"out_of_banks"|"unknown", "change_vs_reference": string (what you see), "confidence": number 0-1}.
Only answer "out_of_banks" if water clearly covers ground that is normally dry (vegetation or trees standing in water, flooded roads). Too dark or foggy: image_usable=false, water_state="unknown".` },
        { inline_data: { mime_type: "image/jpeg", data: await b64(IMG + cam.id + "/" + file) } }];
    const visionResult = await vision(parts);
    const isLive = file === live.file;
    const gauge = isLive && live.gauge ? { stage: live.gauge.stage, time: live.gauge.time } : await gaugeAt(cam.usgs, fileTime(file)).catch(() => null);
    const expected = gauge && expectedFromGauge(gauge.stage, live.gauge?.categories);
    const agreement = visionResult.water_state === "unknown" ? "no visual check" : !expected ? "no gauge reading" : expected.includes(visionResult.water_state) ? "agrees with gauge" : "DISAGREES with gauge";
    const out = { camera: cam.name, file, image: IMG + cam.id + "/" + file, time: fileTime(file), vision: visionResult, gauge, expected, agreement, reference: cam.ref ? IMG + cam.id + "/" + cam.ref : null, model: VISION_MODEL };
    visionCache.set(file, out);
    return out;
  }

  /* ---------- student reports ---------- */

  async function addReport({ lat, lon, note, photo }) {
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw bad("location required");
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo || "");
    if (!m) throw bad("photo required (jpeg/png/webp)");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4_000_000) throw bad("photo too large (max 4 MB)");
    const id = crypto.randomUUID().slice(0, 8);
    fs.writeFileSync(path.join(photoDir, `${id}.${m[1]}`), buf);
    let ai;
    try {
      ai = await vision([
        { text: `A person submitted this photo as a street-flooding report. Judge only what is visible.
Return JSON only: {"usable": bool, "water_on_ground": bool, "depth_cm": [low, high] or null, "depth_reference": string (what you compared against, e.g. "curb ~15 cm", "car wheel ~60 cm"), "looks_like_flood": bool, "concerns": string or null (e.g. "indoor photo", "screenshot", "puddle only", "night"), "confidence": number 0-1}.
Be conservative: if no reference object is visible, give a wide depth range.` },
        { inline_data: { mime_type: `image/${m[1]}`, data: m[2] } },
      ]);
    } catch (e) {
      ai = { usable: false, error: String(e.message || e) };
    }
    // Fingerprint so the same photo sent twice can't corroborate itself.
    const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const rec = { id, time: new Date().toISOString(), lat: +lat, lon: +lon, note: String(note || "").slice(0, 280), ext: m[1], hash, ai, model: VISION_MODEL };
    reports.push(rec);
    fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 1));
    return rec;
  }

  const photo = (id) => {
    const r = reports.find((x) => x.id === id);
    return r && { path: path.join(photoDir, `${r.id}.${r.ext}`), type: `image/${r.ext}` };
  };

  /** Admin decision on a report: confirmed closes nearby roads like a sensor would, rejected removes it as evidence. */
  function review(id, verdict) {
    const r = reports.find((x) => x.id === id);
    if (!r) throw Object.assign(new Error("no such report"), { status: 404 });
    if (!["confirmed", "rejected"].includes(verdict)) throw Object.assign(new Error("verdict must be confirmed or rejected"), { status: 400 });
    r.review = { verdict, at: new Date().toISOString() };
    fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 1));
    return r;
  }

  return { cameras, checkCamera, addReport, listReports: () => reports, photo, review };
}
