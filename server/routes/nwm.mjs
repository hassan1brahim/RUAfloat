// NOAA feature: National Water Model flash-flood, arrival-time, probability and flood-extent layers around campus.
import { send } from "../lib/http.mjs";
import { createNwm } from "../lib/nwm.mjs";

export default function register(api) {
  const nwm = createNwm();
  api.get("/api/nwm", async (req, res) => send(res, 200, await nwm()));
}
