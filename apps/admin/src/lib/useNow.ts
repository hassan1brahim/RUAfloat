"use client";
import { useEffect, useState } from "react";

/** Ticks every `intervalMs` so "updated Xm ago" labels stay accurate without re-fetching anything. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
