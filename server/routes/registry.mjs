// Route modules in load order.
import live from "./live.mjs";
import guide from "./guide.mjs";
import detect from "./detect.mjs";
import nwm from "./nwm.mjs";
import forecast from "./forecast.mjs";
import assist from "./assist.mjs";
import agent from "./agent.mjs";
import places from "./places.mjs";
import sensors from "./sensors.mjs";
import admin from "./admin.mjs";

export default [live, guide, sensors, detect, nwm, forecast, assist, agent, places, admin];
