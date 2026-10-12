"""每天收盤後抓追蹤清單裡台股的本益比（PE）、股價淨值比（PB）、殖利率，
並計算目前 PE 在近 3 年的百分位，寫進 pe.json。資料來源：FinMind（證交所／櫃買中心每日公布值）。"""
import json, time, statistics, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from update_market import watchlist, TW, UA

ROOT = Path(__file__).resolve().parent.parent
YEARS = 3


def finmind(code, start):
    url = f"https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPER&data_id={code}&start_date={start}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d.get("data") or []


def main():
    start = (datetime.now(TW) - timedelta(days=365 * YEARS)).strftime("%Y-%m-%d")
    out = {}
    for code, mkt in watchlist():
        if mkt != "台股":
            continue
        try:
            rows = finmind(code, start)
        except Exception as e:
            print(code, "失敗：", e)
            time.sleep(2)
            continue
        if not rows:
            print(code, "沒有資料")
            continue
        last = rows[-1]
        hist = [r["PER"] for r in rows if r.get("PER") and r["PER"] > 0]
        per = last.get("PER") if last.get("PER") and last["PER"] > 0 else None
        e = {"date": last.get("date"), "per": per, "pbr": last.get("PBR") or None,
             "dy": last.get("dividend_yield") if last.get("dividend_yield") is not None else None, "years": YEARS}
        if per and len(hist) >= 60:
            e["pct"] = round(sum(1 for v in hist if v < per) / len(hist), 3)
            e["min"], e["max"], e["med"] = round(min(hist), 2), round(max(hist), 2), round(statistics.median(hist), 2)
        out[code.upper()] = e
        print(code, e)
        time.sleep(0.6)
    if not out:
        print("這次沒有抓到任何資料，保留舊檔")
        return
    (ROOT / "pe.json").write_text(json.dumps({"updated": datetime.now(TW).isoformat(timespec="seconds"), "data": out},
                                             ensure_ascii=False, indent=1), encoding="utf-8")
    print("完成", len(out), "檔")


if __name__ == "__main__":
    main()
