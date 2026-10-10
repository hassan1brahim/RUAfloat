# Redbridge Admin

Admin/dispatch dashboard for the flood response app. Next.js + Leaflet, talking to `apps/server`.

```
npm run dev:admin   # from the repo root — API on :8787, dashboard on :3000
```

## Dispatch signal — what it actually does

Clicking **Signal dispatch** on a flagged road/building:

1. Opens a dropdown of the real nearest hospital/police/fire stations (the same live OSM data the map uses), sorted by distance, with a manual "Other" fallback.
2. On Confirm, `POST /api/dispatch` saves a record (`{ target, unit, status: "pending", ... }`) to the server's local store.
3. That's it — the "signal" is an HTTP call to **our own backend**, not to any external system.

**It does not contact the real station.** Naming "City of New Brunswick Police Station" as the unit records *that the admin decided to send them*, it does not place a call, send an SMS, or touch any real department's CAD/radio system. The actual "tell them to go" still happens the way the team's design intended: a human phone or radio call, outside the app.

### `/unit` — a demo stand-in for "the unit's phone"

A second page in this same app (not a separate service) that polls `GET /api/dispatch` every 4s and shows new `pending` entries as a pulsing, audible alert, with the same acknowledge → en-route → on-scene → cleared buttons as the admin side.

For a pitch: open `/` on your laptop and `/unit` on a phone/second screen on the same network. Signal a dispatch on the admin side and the `/unit` screen lights up within a few seconds — demonstrates the "admin signals, unit responds" loop live, without any SMS/push/webhook infrastructure.

It is **not** wired to anything a real police/fire/hospital unit watches. If this needs to reach a real unit later, that's a separate integration (SMS via Twilio, a push-enabled companion app, or a Slack/Discord webhook the unit's own phone has installed) — this page just proves the admin→unit loop works end to end for the demo.
