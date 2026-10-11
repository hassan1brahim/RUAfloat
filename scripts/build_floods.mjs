// Real Raritan floods for the replay picker: hourly USGS readings at Bound Brook (01403060), the gauge the flood model uses.
// Ida comes from ida.json (unchanged); the rest from the USGS Water Data API. Usage: node scripts/build_floods.mjs
import fs from "node:fs";

const OUT = new URL("../web/public/data/", import.meta.url);
const API = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items";

/** Window: from about a day before the rise to a day or two after the crest. Peaks are USGS's own records for this gauge. */
const FLOODS = [
  { id: "irene", short: "Irene 2011", name: "Hurricane Irene", year: 2011, from: "2011-08-27T04", to: "2011-08-31T04", what: "Tropical Storm Irene, Aug 27–30, 2011" },
  { id: "mar2010", short: "Mar 2010 nor'easter", name: "March 2010 nor'easter", year: 2010, from: "2010-03-12T04", to: "2010-03-17T04", what: "Nor'easter, Mar 12–16, 2010" },
  { id: "may2014", short: "Spring 2014", name: "Spring 2014 storm", year: 2014, from: "2014-04-29T04", to: "2014-05-03T04", what: "Heavy rain, Apr 29 – May 2, 2014" },
  { id: "dec2023", short: "Dec 2023", name: "December 2023 storm", year: 2023, from: "2023-12-17T04", to: "2023-12-21T04", what: "Heavy rain and wind, Dec 17–20, 2023" },
  { id: "jan2024", short: "Jan 2024", name: "January 2024 storm", year: 2024, from: "2024-01-09T04", to: "2024-01-12T04", what: "Heavy rain, Jan 9–11, 2024" },
  { id: "apr2022", short: "Apr 2022", name: "April 2022 storm", year: 2022, from: "2022-04-07T04", to: "2022-04-11T04", what: "Heavy rain, Apr 7–10, 2022" },
];

async function series(from, to) {
  const u = new URL(API);
  Object.entries({ f: "json", monitoring_location_id: "USGS-01403060", parameter_code: "00065", time: `${from}:00:00Z/${to}:00:00Z`, limit: "2000" })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { "User-Agent": "ruafloat-hackru (flood replays)" } });
  if (!r.ok) throw new Error(`${from}: USGS ${r.status}`);
  const pts = (await r.json()).features.map((x) => [x.properties.time, +x.properties.value]).sort((a, b) => a[0].localeCompare(b[0]));
  return { pts, hourly: pts.filter((p) => p[0].slice(14, 16) === "00") };
}

const ida = JSON.parse(fs.readFileSync(new URL("ida.json", OUT)));
const out = [{ id: "ida", short: "Ida 2021", name: "Hurricane Ida", year: 2021, what: "Remnants of Hurricane Ida, Sept 1–3, 2021", crest: ida.crest, series: ida.series }];
for (const f of FLOODS) {
  const { pts, hourly } = await series(f.from, f.to);
  const crest = pts.reduce((a, b) => (b[1] > a[1] ? b : a));   // the true crest, which may fall between hours
  out.push({ id: f.id, short: f.short, name: f.name, year: f.year, what: f.what, crest, series: hourly });
  console.log(`${f.name} ${f.year}: ${hourly.length} hours, crest ${crest[1]} ft at ${crest[0].slice(0, 16)}`);
}
out.sort((a, b) => b.crest[1] - a.crest[1]);   // biggest first
fs.writeFileSync(new URL("floods.json", OUT), JSON.stringify(out));
console.log(`wrote floods.json: ${out.length} floods`);
