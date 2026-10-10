/** Share links: ?scenario=ida&t=2021-09-02T16&from=Scott%20Hall&guide=1 opens the app in exactly that state. */
import type { Feature, Mode } from "../../core/app";

let ready = false;   // the URL is read once at start, before any update can rewrite it

const feature: Feature = {
  id: "share",
  init() {},
  async ready(app) {
    const q = app.params, river = app.get("river");
    const sc = q.get("scenario") as Mode | null;
    if (sc === "ida") {
      const t = q.get("t"), s = river.ida.series;
      const i = t ? s.findIndex((p) => p[0] >= t) : s.findIndex((p) => p[0] === river.ida.crest[0].slice(0, 19) + "+00:00");
      river.setIdaIndex(i >= 0 ? i : s.reduce((b, p, k) => (p[1] > s[b][1] ? k : b), 0));
    }
    if (sc === "whatif" && q.get("stage")) river.setWhatIf(+q.get("stage")!);
    if (sc) river.setMode(sc);
    const guide = app.maybe("guide"), from = q.get("from");
    const st = from && guide?.starts.find((s) => s.name.toLowerCase() === from.toLowerCase());
    if (st) guide!.setStart(st);
    ready = true;
    app.update();
    if (st && q.get("guide") === "1") await guide!.run();
  },
  update(app) {
    if (!ready) return;
    const q = new URLSearchParams(), river = app.get("river");
    if (app.state.view === "admin") q.set("view", "admin");
    q.set("scenario", app.state.mode);
    if (app.state.mode === "ida") q.set("t", river.ida.series[river.idaIndex()][0].slice(0, 13));
    if (app.state.mode === "whatif") q.set("stage", app.state.stageFt.toFixed(1));
    const start = app.maybe("guide")?.start();
    if (start && start.name !== "Pinned location" && start.name !== "Your location") q.set("from", start.name);
    history.replaceState(null, "", `?${q}`);
  },
};
export default feature;
