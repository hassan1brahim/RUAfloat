"""Fetch USGS continuous (15-min) records from the Water Data OGC API, cached as hourly CSV.

    usgs.series("01403060", "00065", "2021-09-01", "2021-09-04")  -> {iso_hour: value}
"""
import csv
import datetime as dt
import os
import pathlib
import time

import requests

CACHE = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "usgs"
API = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items"
UA = {"User-Agent": "HackRU-26/0.1 (Rutgers flood command)"}


PAUSE_S = 2.0  # USGS rate-limits keyless clients (HTTP 429); stay polite, the app shares this API


def _get(url, params=None):
    """GET with USGS's rate limit respected: on 429, sleep exactly as long as Retry-After says."""
    time.sleep(PAUSE_S)
    errors = 0
    while True:
        try:
            r = requests.get(url, params=params, headers=UA, timeout=180)
        except requests.RequestException as e:
            errors += 1
            if errors > 5:
                raise
            print("  usgs network retry", errors, e, flush=True)
            time.sleep(20 * errors)
            continue
        if r.status_code == 429:
            wait = int(r.headers.get("retry-after", "600")) + 5
            print(f"  usgs rate limit: waiting {wait} s", flush=True)
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            errors += 1
            if errors > 5:
                r.raise_for_status()
            time.sleep(20 * errors)
            continue
        r.raise_for_status()
        return r.json()


def _fetch_raw(site, param, start, end):
    """All points in [start, end), following the API's `next` links."""
    out = {}
    d = _get(API, {"f": "json", "monitoring_location_id": f"USGS-{site}", "parameter_code": param,
                   "time": f"{start}T00:00:00Z/{end}T00:00:00Z", "limit": 50000, "properties": "time,value"})  # a year of 15-min data in one page
    while True:
        for f in d.get("features", []):
            v = f["properties"]["value"]
            if v not in (None, ""):
                out[f["properties"]["time"]] = float(v)
        nxt = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
        if not nxt:
            return out
        d = _get(nxt)


def series(site, param, start, end):
    """Hourly means {YYYY-MM-DDTHH: value}, cached per site/param/year."""
    CACHE.mkdir(parents=True, exist_ok=True)
    result = {}
    y0, y1 = int(start[:4]), int(end[:4])
    for y in range(y0, y1 + 1):
        path = CACHE / f"{site}_{param}_{y}.csv"
        if not path.exists():
            if os.environ.get("USGS_OFFLINE"):   # Offline runs must not wait on the USGS rate limit.
                raise RuntimeError(f"USGS_OFFLINE and {path.name} is not cached")
            s, e = f"{y}-01-01", f"{y + 1}-01-01"
            if y == dt.date.today().year:
                e = (dt.date.today() + dt.timedelta(days=1)).isoformat()
            raw = _fetch_raw(site, param, s, e)
            hours = {}
            for t, v in raw.items():
                hours.setdefault(t[:13], []).append(v)
            with open(path, "w", newline="") as fh:
                w = csv.writer(fh)
                for h in sorted(hours):
                    w.writerow([h, round(sum(hours[h]) / len(hours[h]), 3)])
            print(f"  cached {path.name}: {len(hours)} hours")
        with open(path) as fh:
            for h, v in csv.reader(fh):
                if start[:13] <= h < end[:13] or (len(start) == 10 and start <= h[:10] < end):
                    result[h] = float(v)
    return result
