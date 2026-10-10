// Loads .env from the repo root before anything reads process.env (imported first by index.mjs).
// Variables already set (Railway, the shell) win; no .env file is fine.
import path from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile?.(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env")); } catch { /* no .env */ }
