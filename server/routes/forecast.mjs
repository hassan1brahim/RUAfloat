// Forecast feature: our ML river forecast, run on live NWS readings from the trees the pipeline exported.
import path from "node:path";
import { send } from "../lib/http.mjs";
import { createForecast } from "../lib/forecast.mjs";

export default function register(api, ctx) {
  const forecast = createForecast({ modelFile: path.join(ctx.webData, "forecast_model.json") });
  api.get("/api/forecast", async (req, res) => send(res, 200, await forecast()));
}
