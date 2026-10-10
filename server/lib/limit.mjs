// Rate limits for endpoints that cost money or lean on someone else's free service.

/** Fixed-window counter per key: `hit(key)` is true while the key is under `max` per `windowMs`. */
export function limiter(max, windowMs, now = () => Date.now()) {
  const seen = new Map();
  return function hit(key) {
    const t = now(), w = seen.get(key);
    if (!w || t - w.start >= windowMs) {
      if (seen.size > 10_000) seen.clear();   // bound memory; a reset only ever lets requests through early
      seen.set(key, { start: t, n: 1 });
      return true;
    }
    return ++w.n <= max;
  };
}

/** Runs calls one at a time, at least `gapMs` apart (Nominatim's policy: max 1 request per second). */
export function spaced(gapMs, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let chain = Promise.resolve(), last = -Infinity;
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

/** The client's address as the server sees it (no proxy headers: they're trivially forged). */
export const clientIp = (req) => req.socket.remoteAddress ?? "?";

export const tooMany = (status = 429) => Object.assign(new Error("too many requests, try again in a minute"), { status });
