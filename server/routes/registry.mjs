// Route modules in load order.
import live from "./live.mjs";
import guide from "./guide.mjs";
import detect from "./detect.mjs";
import nwm from "./nwm.mjs";
import forecast from "./forecast.mjs";
import assist from "./assist.mjs";
import sensors from "./sensors.mjs";

export default [live, guide, detect, sensors, nwm, forecast, assist];
