# HackRU-26

Raritan flood dashboard for Rutgers New Brunswick: live river level, flooded roads, walking routes to dry gathering points, spoken by voice.

**Built before HackRU:** the app in `web/` and the API routes in `server/routes/` + `server/lib/` are ported from RU Ready (private repo `ru-ready`, last pre-event commit 2026-10-10 08:55 ET). **Built at HackRU:** everything else, in this repo's history under whoever wrote it.

## Run

```bash
nvm use 20 && npm install
cp .env.example .env          # GEMINI_API_KEY sent privately, never in git
set -a; source .env; set +a
npm run dev                   # API :8787, app http://localhost:5173
```

`curl localhost:8787/api/health` should show `"gemini":true`. If ports are taken: `PORT=8788 WEB_PORT=5174 npm run dev`.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Sensor API, token check, demo links |
| `npm run typecheck` / `npm run build` | Frontend type check / production build |
| `npm run sensor:sim -- 45 60` | Fake sensor: water rises to 45 cm over 60 s |
| `npm run demo:links -- https://<public-host>` | Checks the demo links, writes `docs/DEMO_LINKS.md` + QR codes (`docs/qr/print.html`) |
| `npm run demo:clean` | Lists test photo reports; `-- --yes` deletes them (then restart the server) |
| `npm run a11y:contrast` | WCAG AA contrast check of the app's colours |

## Demo links

Share links open an exact state: `?scenario=ida&t=2021-09-02T16&from=Scott%20Hall&guide=1` (`t` is UTC; 16 = noon ET, Ida's crest). Generate the judges' QR sheet with `npm run demo:links` against the public URL, and test every link in a private window.

## Before the demo

1. `npm run demo:clean -- --yes`, restart the server.
2. Run the manual checks in `docs/A11Y_MOBILE_AUDIT.md`.
