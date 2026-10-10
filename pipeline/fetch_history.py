"""Download 15 years of hourly stage for the Bound Brook target + 6 upstream gauges (cached by usgs.py)."""
import sys
import usgs

GAUGES = {"BDKN4": "01403060", "MNVN4": "01400500", "RRTN4": "01400000", "STTN4": "01397000",
          "BKWN4": "01402000", "PCTN4": "01401000", "BDBN4": "01403200"}
if __name__ == "__main__":
    start = sys.argv[1] if len(sys.argv) > 1 else "2012-01-01"
    for lid, site in GAUGES.items():
        print(lid, site, flush=True)
        s = usgs.series(site, "00065", start, "2026-10-11")
        print(f"  {lid}: {len(s)} hours", flush=True)
