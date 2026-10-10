import "maplibre-gl/dist/maplibre-gl.css";
import "./core/base.css";
import { App } from "./core/app";
import { createMap } from "./core/map";
import { FEATURES } from "./features/registry";

new App(FEATURES).start(createMap).catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("afterbegin", `<pre style="color:#f87171;padding:12px">Failed to start: ${e}</pre>`);
});
