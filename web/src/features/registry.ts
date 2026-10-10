/** Features in load order. Each port step adds one line here. */
import type { Feature } from "../core/app";
import river from "./river";
import flood from "./flood";
import roads from "./roads";
import guide from "./guide";
import layers from "./layers";
import buildings from "./buildings";
import roadpanel from "./roadpanel";
import detection from "./detection";
import nwm from "./nwm";
import forecast from "./forecast";
import voice from "./voice";
import share from "./share";
import about from "./about";

export const FEATURES: Feature[] = [river, flood, roads, guide, layers, buildings, roadpanel, detection, nwm, forecast, voice, share, about];
