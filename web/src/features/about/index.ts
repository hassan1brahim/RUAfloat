/** How to read the map, how accurate it is, and every data source. */
import type { Feature } from "../../core/app";
import { et } from "../../core/util";

const STATIC_SOURCES = [
  { name: "USGS 3DEP elevation", url: "https://www.usgs.gov/3d-elevation-program" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
  { name: "FEMA NFHL", url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer" },
  { name: "NOAA National Water Model", url: "https://water.noaa.gov/" },
  { name: "USGS HIVIS cameras", url: "https://apps.usgs.gov/hivis/" },
  { name: "Rutgers Facilities, Dining & PAMS air datasets", url: "https://ipo.rutgers.edu/" },
];

const feature: Feature = {
  id: "about",
  init(app) {
    const el = app.card({ col: "right", id: "about-card", title: "How to read this", order: 90, html: `
      <div class="fine">Flood extent is an estimate: Raritan rise (Bound Brook stage minus 17 ft) spread by height above the nearest river cell over USGS 3DEP elevation, the method NOAA's flood maps use. It is not an NWS inundation map.
      <br><b>How good is it?</b> Against NOAA's official maps on the Bound Brook reach it agrees on about two-thirds of the flooded area (overlap 0.60–0.68, catches 71–76% of NOAA's flooding) and under-calls more than it over-calls. Its Ida closures match records: Route 18, River Road, Albany St, the streets between Route 18 and Neilson St, and the Rutgers boathouse. New Brunswick may rise ~13% less than Bound Brook, so depths are shown as a range; routing uses the higher, safer end.
      Gathering points are large Rutgers buildings on high ground, <u>not designated shelters</u>. Follow RU Alert and officials.
      <div class="muted" id="sources"></div></div>` });
    const render = () => {
      const live = app.maybe("river")?.live();
      el.querySelector("#sources")!.innerHTML = "Sources: " + [...(live?.sources ?? []), ...STATIC_SOURCES]
        .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(" · ") + (live ? ` · fetched ${et(live.fetched_at)} ET` : "");
    };
    render();
    setInterval(render, 60_000);
  },
};
export default feature;
