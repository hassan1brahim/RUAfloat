// Pre-demo cleanup: removes test photo reports so none show on the map. Dry run unless --yes.
// Usage: npm run demo:clean            (lists what would go)
//        npm run demo:clean -- --yes   (deletes, then restart the server: it keeps reports in memory)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/live");
const TARGETS = [path.join(LIVE, "reports.json"), path.join(LIVE, "report-photos")];
const yes = process.argv.includes("--yes");

/** Files under a path, for the dry-run listing. */
const files = (p) => (!fs.existsSync(p) ? [] : fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => files(path.join(p, f))) : [p]);

const found = TARGETS.flatMap(files);
if (!found.length) { console.log("Nothing to clean: no test reports in data/live/."); process.exit(0); }

const reports = fs.existsSync(TARGETS[0]) ? JSON.parse(fs.readFileSync(TARGETS[0], "utf8")) : [];
console.log(`${reports.length} report(s), ${found.length} file(s):`);
for (const f of found) console.log(`  ${path.relative(process.cwd(), f)}`);

if (!yes) { console.log("\nDry run. Re-run with --yes to delete."); process.exit(0); }
for (const t of TARGETS) fs.rmSync(t, { recursive: true, force: true });
console.log("\nDeleted. Restart the server (npm run dev) so it forgets them.");

try {
  const r = await fetch(`http://localhost:${process.env.PORT || 8787}/api/reports`, { signal: AbortSignal.timeout(1000) });
  if ((await r.json()).length) console.log("! The running server still shows reports: restart it now.");
} catch { /* server not running: nothing to restart */ }
