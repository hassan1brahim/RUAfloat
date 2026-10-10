// ESP32 street water sensor: ultrasonic sensor pointing straight down, posts distance to the API every 10 s.
// Wiring: TRIG -> GPIO 5, ECHO -> GPIO 18 through a 5V->3.3V divider (1k / 2k), VCC -> 5V, GND -> GND.
// Copy secrets.example.h to secrets.h and fill it in (secrets.h is gitignored).
#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h"

const int TRIG = 5, ECHO = 18;
const unsigned long PERIOD_MS = 10000;

// One ping in cm, or -1 on timeout (~5 m).
float ping() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  return us ? us * 0.0343f / 2.0f : -1;
}

// Median of 5 pings: ignores splashes and raindrops.
float distanceCm() {
  float s[5];
  for (int i = 0; i < 5; i++) { s[i] = ping(); delay(60); }
  for (int i = 1; i < 5; i++) for (int j = i; j > 0 && s[j] < s[j - 1]; j--) { float t = s[j]; s[j] = s[j - 1]; s[j - 1] = t; }
  return s[2];
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " wifi ok " + WiFi.localIP().toString() : " wifi failed, retrying next cycle");
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  connectWifi();
}

void loop() {
  connectWifi();
  float d = distanceCm();
  if (d <= 0) {
    Serial.println("no echo");
  } else if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.setTimeout(5000);
    http.begin(String(API_BASE) + "/api/sensors/" + SENSOR_ID);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-sensor-token", SENSOR_TOKEN);
    int code = http.POST(String("{\"distance_cm\":") + String(d, 1) + "}");
    Serial.printf("distance %.1f cm -> HTTP %d %s\n", d, code, code > 0 ? http.getString().c_str() : "");
    http.end();
  }
  delay(PERIOD_MS);
}
