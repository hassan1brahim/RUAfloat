/** Student view during a What-if: no scenario controls, just a DRILL tag so nobody mistakes it for the real river. */
import type { Feature } from "../../core/app";
import { $, et } from "../../core/util";
import "./style.css";

let shown = "";

const feature: Feature = {
  id: "drill",
  init(app) {
    const tag = document.createElement("span");
    tag.id = "drill-tag";
    tag.className = "pill drill";
    tag.dataset.views = "student";
    tag.setAttribute("role", "status");   // a drill starting or ending is worth announcing
    tag.hidden = true;
    app.heroStatus(tag);
    $("whatif-bar").dataset.views = "admin";   // the controls stay with the admin
  },
  update(app) {
    const river = app.maybe("river"), m = app.state.mode;
    const text = m === "ida" && river ? `DRILL · ${river.ida.short} · ${et(river.ida.series[river.idaIndex()][0])}` : m === "whatif" ? `DRILL · ${app.state.stageFt.toFixed(1)} ft what-if` : "";
    if (text === shown) return;
    shown = text;
    $("drill-tag").textContent = text;
    $("drill-tag").hidden = !text;
  },
};
export default feature;
