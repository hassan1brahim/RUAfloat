"""Machine-learning river forecast: Bound Brook level 3, 6, 12 and 18 hours ahead from 7 upstream/local gauges,
plus the rain that has already fallen (Somerset Airport hourly gauge), which reaches the river hours later.

Why ML here: this is where we have real answers to learn from (15 years of hourly USGS readings).
Water reaching Bound Brook passes Manville, the North/South Branch and the Millstone first, so their
levels and how fast they are rising carry hours of warning.

Honest test: whole years are held out (2021 with Ida, 2023, 2024 with the Jan flood), so the model
never sees the storms it is scored on. Baseline = "the river stays where it is" (persistence).

Run: python pipeline/train_forecast.py web/public/data   (rain CSVs from the IEM ASOS archive in data/raw/rain/smq_YYYY.csv)
Outputs: data/validation/forecast.json (scores), web/public/data/forecast_model.json (trees for the app),
web/public/data/ida_forecast.json (what the model would have said during Ida, hour by hour).
"""
import datetime as dt
import json
import os
import pathlib
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import usgs  # noqa: E402
from fetch_history import GAUGES  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = "BDKN4"
HORIZONS = [3, 6, 12, 18]
RAIN_WINDOWS = [3, 6, 12, 24]   # hours of past rain summed
RAIN_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "rain"
OUT = pathlib.Path(sys.argv[1])   # the app's web/public/data folder
LAGS = [1, 3, 6]
TEST_YEARS = {2021, 2023, 2024}
START, END = "2012-01-01", "2026-10-11"
ACTION_FT = 26.0


def rain_hourly(idx):
    """Hourly rain (inches) at Somerset Airport (KSMQ), from the IEM ASOS archive: the routine :5x report holds the hour's total."""
    by_hour = {}
    for f in sorted(RAIN_DIR.glob("smq_*.csv")):
        for line in f.read_text().splitlines()[1:]:
            _, valid, v = line.split(",")
            if int(valid[14:16]) < 50 or v == "M":
                continue
            by_hour[valid[:10] + "T" + valid[11:13]] = 0.0 if float(v) < 0.001 else float(v)
    arr = np.array([by_hour.get(h, 0.0) for h in idx])   # missing reports count as no rain
    print(f"rain: {sum(h in by_hour for h in idx) / len(idx):.0%} of hours reported, {arr.sum():.0f} in total")
    return arr


def hours(start, end):
    t = dt.datetime.fromisoformat(start)
    e = dt.datetime.fromisoformat(end)
    while t < e:
        yield t.strftime("%Y-%m-%dT%H")
        t += dt.timedelta(hours=1)


def load():
    idx = list(hours(START, END))
    cols = {}
    for lid, site in GAUGES.items():
        s = usgs.series(site, "00065", START, END)
        arr = np.array([s.get(h, np.nan) for h in idx], dtype=float)
        # fill short gaps (<= 3 h) forward; longer gaps stay missing and those rows are dropped
        last, gap = np.nan, 0
        for i in range(len(arr)):
            if np.isnan(arr[i]):
                gap += 1
                if gap <= 3:
                    arr[i] = last
            else:
                last, gap = arr[i], 0
        cols[lid] = arr
        print(f"{lid}: {np.isfinite(arr).mean():.0%} of hours present")
    cols["RAIN"] = rain_hourly(idx)
    return idx, cols


USE_RAIN = os.environ.get("NO_RAIN") != "1"


def feature_names():
    names = []
    for lid in GAUGES:
        names.append(f"{lid}_now")
        names += [f"{lid}_d{l}" for l in LAGS]
    names.append(f"{TARGET}_d12")
    if USE_RAIN:
        names += [f"rain_{w}h" for w in RAIN_WINDOWS]
    return names


def features_at(cols, i):
    row = []
    for lid in GAUGES:
        a = cols[lid]
        row.append(a[i])
        row += [a[i] - a[i - l] for l in LAGS]
    row.append(cols[TARGET][i] - cols[TARGET][i - 12])
    if USE_RAIN:
        row += [float(cols["RAIN"][max(0, i - w + 1):i + 1].sum()) for w in RAIN_WINDOWS]
    return row


def build(idx, cols):
    X, Y, keep_i = [], {h: [] for h in HORIZONS}, []
    tgt = cols[TARGET]
    for i in range(24, len(idx) - max(HORIZONS)):
        row = features_at(cols, i)
        ys = [tgt[i + h] - tgt[i] for h in HORIZONS]
        if np.all(np.isfinite(row)) and np.all(np.isfinite(ys)):
            X.append(row)
            for h, y in zip(HORIZONS, ys):
                Y[h].append(y)
            keep_i.append(i)
    return np.array(X), {h: np.array(v) for h, v in Y.items()}, np.array(keep_i)


def export_tree(t):
    tr = t.tree_
    return {"f": tr.feature.tolist(), "t": [round(float(x), 4) for x in tr.threshold], "l": tr.children_left.tolist(),
            "r": tr.children_right.tolist(), "v": [round(float(x), 5) for x in tr.value[:, 0, 0]]}


def main():
    idx, cols = load()
    X, Y, rows = build(idx, cols)
    years = np.array([int(idx[i][:4]) for i in rows])
    test = np.isin(years, list(TEST_YEARS))
    now = X[:, list(GAUGES).index(TARGET) * (1 + len(LAGS))]
    print(f"rows: {len(X)} ({(~test).sum()} train, {test.sum()} test)")
    report, models = {}, {}
    for h in HORIZONS:
        y = Y[h]
        w = 1 + 9 * (now >= 22)  # high water is rare but it is what matters
        m = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)
        m.fit(X[~test], y[~test], sample_weight=w[~test])
        pred = m.predict(X[test])
        truth_level = now[test] + y[test]
        high = (np.maximum(now[test], truth_level) >= ACTION_FT)
        mae = lambda a, b, msk: round(float(np.mean(np.abs(a[msk] - b[msk]))), 2) if msk.any() else None
        all_m = np.ones(test.sum(), bool)
        report[f"{h}h"] = {
            "mae_ft_all": mae(pred, y[test], all_m), "persistence_mae_ft_all": mae(np.zeros_like(pred), y[test], all_m),
            "mae_ft_high_water": mae(pred, y[test], high), "persistence_mae_ft_high_water": mae(np.zeros_like(pred), y[test], high),
            "high_water_hours": int(high.sum()),
        }
        models[h] = m
        print(h, "h:", report[f"{h}h"])

    # What it would have said during Ida (test year: never trained on)
    ida_hours = [i for i in range(len(idx)) if "2021-09-01T04" <= idx[i] <= "2021-09-04T04"]
    ida = []
    for i in ida_hours:
        row = features_at(cols, i)
        if not np.all(np.isfinite(row)):
            continue
        p = {f"{h}h": round(float(cols[TARGET][i] + models[h].predict([row])[0]), 2) for h in HORIZONS}
        actual = {f"{h}h": (round(float(cols[TARGET][i + h]), 2) if np.isfinite(cols[TARGET][i + h]) else None) for h in HORIZONS}
        ida.append({"t": idx[i] + ":00:00Z", "now": round(float(cols[TARGET][i]), 2), "pred": p, "actual": actual})
    crest_t = max(ida, key=lambda r: r["now"])["t"]
    crest_i = next(k for k, r in enumerate(ida) if r["t"] == crest_t)
    lead = {f"{h}h": {"issued": ida[crest_i - h]["t"], "predicted_ft": ida[crest_i - h]["pred"][f"{h}h"], "actual_ft": ida[crest_i]["now"]}
            for h in HORIZONS if crest_i - h >= 0}
    report["ida_crest_from_earlier"] = lead
    print("Ida crest, predicted from earlier:", lead)

    tag = "" if USE_RAIN else "_norain"
    out_dir = OUT.parent / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"forecast{tag}.json").write_text(json.dumps({"test_years": sorted(TEST_YEARS), "scores": report}, indent=1))
    (OUT / f"ida_forecast{tag}.json").write_text(json.dumps(ida))
    (OUT / f"forecast_model{tag}.json").write_text(json.dumps({
        "target": TARGET, "gauges": GAUGES, "lags": LAGS,
        "rain": {"station": "SMQ", "windows_h": RAIN_WINDOWS, "source": "Iowa Environmental Mesonet ASOS archive (Somerset Airport)"} if USE_RAIN else None, "features": feature_names(), "horizons": HORIZONS,
        "models": {str(h): {"init": float(models[h].init_.constant_[0][0]) if hasattr(models[h].init_, "constant_") else float(np.mean(Y[h][~test])),
                            "lr": models[h].learning_rate, "trees": [export_tree(e[0]) for e in models[h].estimators_]} for h in HORIZONS},
        "scores": report, "trained_on": f"{START[:4]}-2026 minus test years {sorted(TEST_YEARS)}",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
