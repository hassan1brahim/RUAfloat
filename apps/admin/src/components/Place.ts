import type { Place } from "@/lib/api";

export const PLACE_COLOR: Record<Place["kind"], string> = { hospital: "#38bdf8", police: "#818cf8", fire: "#fb923c" };
export const TIER_COLOR: Record<"closed" | "watch", string> = { closed: "#ef4444", watch: "#fbbf24" };
