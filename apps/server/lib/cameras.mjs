/** USGS HIVIS river camera feed near campus — public, independent of any vision-AI step.
 * The admin views the latest image + the paired gauge reading and judges it themselves. */
const UA = "hackru26-admin/0.1";
const IMG_BASE = "https://usgs-nims-images.s3.amazonaws.com/720/";

export const CAMERAS = [
  { id: "NJ_Raritan_River_at_Manville", lid: "MNVN4", name: "Raritan River at Manville" },
  { id: "NJ_Lawrence_Brook_at_Westons_Mills", lid: "LABN4", name: "Lawrence Brook at Westons Mills" },
  { id: "NJ_Millstone_River_at_Blackwells_Mills", lid: "BKWN4", name: "Millstone River at Blackwells Mills" },
];

async function getJson(url, timeoutMs = 10000) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function fetchCameras() {
  const list = await getJson("https://api.waterdata.usgs.gov/nims/cameras").catch(() => []);
  const byId = new Map(list.map((c) => [c.camId, c]));
  return Promise.all(CAMERAS.map(async (cam) => {
    const c = byId.get(cam.id);
    const file = c ? `${cam.id}___${c.newestImageDT.slice(0, 19).replace(/:/g, "-")}Z.jpg` : null;
    let gauge = null;
    try {
      const g = await getJson(`https://api.water.noaa.gov/nwps/v1/gauges/${cam.lid}`);
      gauge = { stageFt: g.status.observed.primary, category: g.status.observed.floodCategory, at: g.status.observed.validTime };
    } catch { /* gauge optional */ }
    return { id: cam.id, name: cam.name, lat: c ? +c.lat : null, lon: c ? +c.lng : null, image: file ? IMG_BASE + cam.id + "/" + file : null, gauge };
  }));
}
