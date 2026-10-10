import { Router } from "express";
import { cached } from "../lib/cache.mjs";
import { fetchNwm } from "../lib/noaa.mjs";
import { ah } from "../lib/asyncHandler.mjs";

const router = Router();
router.get("/nwm", ah(async (req, res) => {
  const { value, fetchedAt, stale, error } = await cached("nwm", 10 * 60_000, fetchNwm);
  res.json({ ...value, fetchedAt, stale, staleError: error });
}));
export default router;
