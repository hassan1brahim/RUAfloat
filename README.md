<p align="center">
  <img src="web/public/logo-512.png" alt="RU Afloat logo" width="120">
</p>

<h1 align="center">RU Afloat</h1>

<p align="center"><b>Getting every Rutgers student out of the flood.</b><br>
Built at HackRU by Hamzah Malik, Sanah Naveed, Haaris Toor and Hassan Ibrahim.</p>

<p align="center">
  <a href="https://web-production-80903.up.railway.app">Live app</a>
</p>

---

## The problem

When the Raritan River floods, as it did during Hurricane Ida in September 2021, students in New Brunswick don't know which roads are about to go under, where it's safe to go, or how to get there without walking through water. Official forecasts give one river level at one gauge. They don't tell a student on College Ave what to do next.

## What RU Afloat does

| Feature | What it does |
|---|---|
| **18-hour river forecast** | A machine-learning model predicts the Raritan at Bound Brook 3, 6, 12 and 18 hours ahead, then shows which campus roads and buildings that water will reach. |
| **Get me to safety** | One tap finds the nearest dry meetup spot and walks you there around every flooded road. Step-free routes and read-aloud directions are built in. |
| **Talk to RU Afloat** | A voice assistant you can just talk to. Ask about the river, your location or a route. Every answer comes from the app's own live data, and a guard rejects any number or place name the app didn't compute. |
| **Coordinator dashboard** | For campus emergency staff: roads closed now and closing next, highest-risk buildings, and a what-if mode that plays a storm forward (including a full Ida replay). |
| **Detect & respond** | Students send photo reports, AI estimates the water depth, and a coordinator dispatches the nearest unit in one tap. Live USGS river cameras are checked by AI against the gauge. |
| **Street sensors** | An ESP32 + ultrasonic sensor measures water depth on a road and closes it automatically (15 cm closes it to walkers, 30 cm to cars). |

## The forecast model

**A regression model** (scikit-learn `GradientBoostingRegressor`) that predicts how many feet the river at Bound Brook will rise or fall.

- **Data:** 15 years (2012 to now) of hourly water levels from **7 USGS river gauges** on the Raritan and its branches, plus hourly rainfall at **Somerset Airport** (Iowa Environmental Mesonet ASOS archive). All of it is free public data.
- **Features (33):** each gauge's level now, how much it changed over the last 1, 3 and 6 hours, the 12-hour change at Bound Brook, and rain over the last 3, 6, 12 and 24 hours.
- **Training:** one model per horizon (3, 6, 12, 18 h), 300 trees each. Hours with the river above 22 ft count 10× because floods are rare but are what matter.
- **Honest test:** whole years are held out (**2021 with Ida, 2023, 2024**), so the model never sees the storms it's scored on.

**Results on the held-out years (average error during high water):**

| Horizon | RU Afloat | "River stays where it is" |
|---|---|---|
| 3 h | 0.25 ft | 1.14 ft |
| 6 h | 0.60 ft | 2.29 ft |
| 12 h | 1.71 ft | 4.58 ft |
| 18 h | 3.31 ft | 6.32 ft |

**Hurricane Ida:** with the river at 31.1 ft on Sep 1, 2021 at 11 PM, the model predicted **40.4 ft** for 18 hours later. The river actually reached **40.9 ft**. Before the rain had fallen, it could not see the storm coming. Adding rainfall *forecasts* is the next step.

The trained trees are exported to `web/public/data/forecast_model.json`, so the app runs the model on live readings with no Python at runtime.

The cameras and street sensors are **not** inputs to the model. The model predicts; they observe, and they override the forecast when they see water it didn't expect.

## Voice agent (ElevenLabs)

"Talk to RU Afloat" is a real-time voice conversation built on **ElevenLabs Agents**, designed so someone can get to safety without looking at the screen.

- **The agent only talks; the app supplies every fact.** It has no flood knowledge of its own. It calls the app through 7 client tools:

  | Tool | What it does |
  |---|---|
  | `get_situation` | River level, flood category, closed roads, alerts, dry gathering points |
  | `find_place` / `set_location` | Turn "I'm at LSM" or "the RAC" into a location (all 324 Rutgers buildings + nicknames) |
  | `use_my_location` | Use the phone's GPS |
  | `plan_route` | Route to the nearest dry gathering point, avoiding roads predicted to flood |
  | `road_status` | Is a specific road open or closed |
  | `end_conversation` | Hang up after the goodbye |

- **Turn-by-turn while walking:** the phone's GPS sends navigation updates into the conversation, so the agent tells you each turn as you reach it.
- **Safety rules in the prompt:** never guess a level, road or route; never call a place "safe" (gathering points are high ground, not official shelters); if someone is in water or in danger, the first thing it says is to call 911 and the Rutgers police number.
- **The API key never reaches the browser:** the server hands out a short-lived signed URL per session, rate-limited per person.
- **Setup:** `npm run agent:setup` creates or updates the agent and saves its id to `.env`. Without it, the app falls back to a command-based voice mode using Gemini plus the browser's built-in speech.

## AI vision (Gemini)

**Google Gemini** (`gemini-3.5-flash-lite` by default, set with `GEMINI_VISION_MODEL`) is used as a check on the ground, never as the forecast.

**River cameras.** USGS runs HIVIS cameras on gauges near campus: the Raritan at Manville, Lawrence Brook at Westons Mills and the Millstone at Blackwells Mills.
1. The server pulls the latest image from each camera.
2. Gemini gets **two images from the same camera**: a reference shot at a normal river level and the current one. It answers in JSON: `normal`, `high_in_banks`, `out_of_banks` or `unknown` (too dark or foggy), with a confidence score.
3. The app compares that answer with the **gauge reading at the same moment** and labels it "agrees with gauge" or "DISAGREES with gauge", keeping the image as evidence.

Why the reference image: without it, the model called a normal 5 ft day "high". With it, 6 of 6 test images matched the gauge (`npm run cameras:check`).

**Student photo reports.** Gemini estimates the water depth as a range in cm, using visible objects as a ruler (a curb is about 15 cm, a car wheel about 60 cm). It flags photos that are indoors, screenshots or just a puddle. A coordinator confirms the report and dispatches a unit in one tap.

**Voice understanding.** In the fallback voice mode, Gemini turns free speech into an intent and explains the app's facts in plain words. A guard rejects any number or street name in its answer that the app didn't compute.

## Data sources

| Source | Used for |
|---|---|
| USGS Water Data (river gauges, HIVIS cameras) | Live river level, model training, camera checks |
| Iowa Environmental Mesonet (Somerset Airport) | Rainfall for the model |
| NOAA MRMS radar & NWS forecasts | Rain-driven street flooding |
| NOAA National Water Model | Small streams and flash flooding |
| FEMA flood zones | Map layer |
| OpenStreetMap | Roads, routing and place search |
| Rutgers building data | 324 campus buildings with their flood heights |

## Tech stack

- **Frontend:** TypeScript, Vite, MapLibre GL
- **Backend:** Node.js (no framework)
- **ML:** Python, scikit-learn, NumPy
- **AI:** ElevenLabs Agents (real-time voice guide), Google Gemini (river-camera and photo checks, voice understanding)
- **Hardware:** ESP32 + HC-SR04 / JSN-SR04T ultrasonic sensor
- **Hosting:** Railway

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env    # optional: add GEMINI_API_KEY / ELEVENLABS_API_KEY
npm run dev             # API on :8787, open http://localhost:5173
```

The app works without any keys. It falls back to template text and the browser's built-in voice.

Other commands:

```bash
npm test                # unit tests
npm run build           # production build
npm start               # serve the production build
npm run sensor:sim      # simulate a street sensor
npm run agent:setup     # create/update the ElevenLabs voice agent
```

Retrain the forecast model:

```bash
pip install -r pipeline/requirements.txt
python pipeline/fetch_history.py
python pipeline/train_forecast.py web/public/data
```

## Project layout

```
web/        frontend (map, student view, admin dashboard, voice)
server/     API: live river, forecast, routing, voice, detection, dispatch, sensors
pipeline/   data download and model training (Python)
hardware/   ESP32 street-sensor sketch and a simulator
scripts/    setup and maintenance scripts
test/       unit tests
```

## Team

- **Hamzah Malik**
- **Sanah Naveed**
- **Haaris Toor**
- **Hassan Ibrahim**
