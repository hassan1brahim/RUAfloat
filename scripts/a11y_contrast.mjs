// WCAG AA contrast check for the app's text colours, read from the CSS so it can't drift from the code.
// Usage: npm run a11y:contrast   (exit 1 if any pair fails)
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/core/base.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const c = (v) => (v.startsWith("--") ? tokens[v.slice(2)] : v);

/** [label, foreground, background, minimum ratio]. 4.5 = normal text, 3 = large/bold text and UI parts. */
const PAIRS = [
  ["body text on panel", "--text", "--panel", 4.5],
  ["muted text on page", "--muted", "--bg", 4.5],
  ["muted text on panel", "--muted", "--panel", 4.5],
  ["muted text on inner panel", "--muted", "--panel-2", 4.5],
  ["links on panel", "--water", "--panel", 4.5],
  ["caution amber on panel", "--warn", "--panel", 4.5],
  ["caution amber on page", "--warn", "--bg", 4.5],
  ["ok green on panel", "--ok", "--panel", 4.5],
  ["red (bad) on panel", "--bad", "--panel", 4.5],
  ["closed-road chip text", "#fca5a5", "--panel-2", 4.5],
  ["observed-road chip text", "#ff8cc6", "--panel-2", 4.5],
  ["replay pill", "--warn", "#2a1d07", 4.5],
  ["minor-flood tag", "#fb923c", "#3d2306", 4.5],
  ["action-flood tag", "#fde047", "#3a3108", 4.5],
  ["moderate-flood tag", "#f87171", "#42110f", 4.5],
  ["major-flood tag", "#f0abfc", "#3b0a2a", 4.5],
  ["white on scarlet button", "#ffffff", "--scarlet", 4.5],
  ["voice button (on)", "#04121c", "--water", 4.5],
  ["focus ring vs page", "#fde047", "--bg", 3],
  ["map hint on dark overlay", "--text", "#080c11", 4.5],
];

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failed = 0;
for (const [label, fg, bg, min] of PAIRS) {
  const [f, b] = [c(fg), c(bg)];
  if (!f || !b) { console.log(`?    ${label}: unknown token ${!f ? fg : bg}`); failed++; continue; }
  const r = ratio(f, b), ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${r.toFixed(2).padStart(5)} (need ${min})  ${label}  ${f} on ${b}`);
}
console.log(failed ? `\n${failed} pair(s) below WCAG AA` : "\nAll pairs pass WCAG AA");
process.exit(failed ? 1 : 0);
