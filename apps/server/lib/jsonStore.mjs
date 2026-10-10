/** Flat-file JSON persistence for sensor readings, student reports, and dispatch pings — swap for a real DB later. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/store");
fs.mkdirSync(DIR, { recursive: true });

export function readStore(name, fallback) {
  const file = path.join(DIR, `${name}.json`);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function writeStore(name, data) {
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 1));
}
