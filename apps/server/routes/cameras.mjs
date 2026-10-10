import { Router } from "express";
import { cached } from "../lib/cache.mjs";
import { fetchCameras } from "../lib/cameras.mjs";
import { ah } from "../lib/asyncHandler.mjs";

const router = Router();
router.get("/cameras", ah(async (req, res) => {
  const { value, fetchedAt, stale, error } = await cached("cameras", 5 * 60_000, fetchCameras);
  res.json({ cameras: value, fetchedAt, stale, staleError: error });
}));
export default router;
