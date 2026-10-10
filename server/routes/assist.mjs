// Voice feature: understand what a blind user said, and answer only from the app's facts (guarded).
import { readBody, send } from "../lib/http.mjs";
import { createAssist } from "../lib/assist.mjs";

export default function register(api) {
  const assist = createAssist();
  api.post("/api/assist/intent", async (req, res) => send(res, 200, await assist.intent(await readBody(req, 200_000))));
  api.post("/api/assist/explain", async (req, res) => send(res, 200, await assist.explain(await readBody(req, 200_000))));
}
