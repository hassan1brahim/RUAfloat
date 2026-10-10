"use client";
import { useNow } from "@/lib/useNow";

function relTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/** "updated Xm ago" + a STALE badge when the panel is showing a cached value because the live fetch failed. */
export default function Freshness({ fetchedAt, stale }: { fetchedAt: string | null; stale?: boolean }) {
  const now = useNow();
  return (
    <span className="freshness">
      {stale && <span className="tag watch" style={{ marginRight: 6 }}>STALE</span>}
      <span className="muted" style={{ fontWeight: 400, textTransform: "none" }}>updated {relTime(fetchedAt, now)}</span>
    </span>
  );
}
