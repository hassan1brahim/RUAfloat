import { Router } from "express";
import { cached } from "../lib/cache.mjs";
import { fetchLive } from "../lib/noaa.mjs";
import { ah } from "../lib/asyncHandler.mjs";

const router = Router();
router.get("/live", ah(async (req, res) => {
  const { value, fetchedAt, stale, error } = await cached("live", 60_000, fetchLive);
  res.json({ ...value, fetchedAt, stale, staleError: error });
}));
export default router;
