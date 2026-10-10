# Street water sensor (ESP32)

An ultrasonic sensor on a pole points straight down at the road. Water depth = mount height − measured distance. The server turns depth into a road status:

| Depth | Status |
|---|---|
| < 3 cm | `dry` |
| 3–15 cm | `caution` |
| ≥ 15 cm | `closed_walking` (NWS: ~15 cm of moving water can knock an adult down) |
| ≥ 30 cm | `closed_vehicles` (~30 cm can float a car) |
| no reading in 15 min | `no_reading` (a dead sensor never keeps a road closed) |

## Parts

- ESP32 dev board
- HC-SR04 (desk demo) or JSN-SR04T (waterproof)
- 1 kΩ + 2 kΩ resistors (ECHO is 5 V, the ESP32 pin is 3.3 V)
- Jumper wires, a tub of water for the demo

## Wiring

| Sensor | ESP32 |
|---|---|
| VCC | 5V |
| GND | GND |
| TRIG | GPIO 5 |
| ECHO | GPIO 18 through the divider: ECHO → 1 kΩ → GPIO 18 → 2 kΩ → GND |

## Setup

1. Server, on the laptop:
   ```bash
   SENSOR_TOKEN=pick-a-secret npm run server
   ```
2. Test without hardware first (this is also the demo fallback):
   ```bash
   SENSOR_TOKEN=pick-a-secret npm run sensor:sim -- 45 60
   curl localhost:8787/api/sensors
   ```
   Status should go `dry` → `caution` → `closed_walking` → `closed_vehicles` and back.
3. Sketch: copy `esp32_flood_sensor/secrets.example.h` to `secrets.h` and fill it in.
   - Use a phone hotspot: venue Wi-Fi often blocks device-to-device traffic.
   - `API_BASE`: the laptop's IP on that network (`ipconfig getifaddr en0`).
   - `SENSOR_TOKEN`: same value as the server.
4. Flash with Arduino IDE (ESP32 board package). Serial Monitor at 115200 should print `distance … cm -> HTTP 200`. `401` = token mismatch, `-1` = can't reach the laptop.

## Calibrate

`mount_cm` in `server/sensors.config.json` must equal the real distance from the sensor to the **dry** surface.

1. Mount the sensor above the empty tub (desk demo: ~30 cm).
2. Read the distance in the Serial Monitor for a minute; take the typical value.
3. Set `mount_cm` to it and restart the server. Status should read `dry`, depth 0–1 cm.
4. Pour water: at 3 cm `caution`, at 15 cm `closed_walking`. With a 30 cm mount the tub won't reach 30 cm; show vehicles closing with the simulator.

## Known issues

- Splashes and mist: the sketch takes the median of 5 pings.
- HC-SR04 is not waterproof; keep it dry above the tub.
- Minimum range ~2 cm (HC-SR04) / ~20 cm (JSN-SR04T): don't let water get closer than that.
