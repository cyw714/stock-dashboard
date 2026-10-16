"""抓追蹤清單裡台股的公開資訊，寫進 info.json：
  - 重大訊息：證交所（上市）與櫃買中心（上櫃）開放資料的「每日重大訊息」，每次執行都會累積，保留 90 天
  - 月營收：近 13 個月營收與年增率、月增率（FinMind，資料來自公開資訊觀測站）
  - 季報：近 8 季 EPS、毛利率、營業利益率（FinMind）
  - 新公布月營收紀錄（rev_log）、除權息預告（exdiv）：給 LINE 盤前晨報用
用法：python update_info.py news   只更新重大訊息（盤中每 30 分鐘）
      python update_info.py all    全部更新（每天一次）
"""
import json, sys, time, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from update_market import watchlist, TW, UA

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "info.json"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def roc_date(s):
    s = str(s or "").strip()
    if len(s) >= 7:
        return f"{int(s[:-4]) + 1911}-{s[-4:-2]}-{s[-2:]}"
    return s


def roc_time(s):
    s = str(s or "").strip().zfill(6)
    return f"{s[:2]}:{s[2:4]}"


def fetch_news(codes):
    items = []
    sources = [
        ("https://openapi.twse.com.tw/v1/opendata/t187ap04_L", "公司代號", "公司名稱"),
        ("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O", "SecuritiesCompanyCode", "CompanyName"),
    ]
    for url, kc, kn in sources:
        try:
            data = get_json(url)
        except Exception as e:
            print("重大訊息失敗：", url, e)
            continue
        for d in data:
            d = {k.strip(): v for k, v in d.items()}
            code = str(d.get(kc, "")).strip()
            if code not in codes:
                continue
            items.append({"code": code, "name": str(d.get(kn, "")).strip(), "date": roc_date(d.get("發言日期")),
                          "time": roc_time(d.get("發言時間")), "title": str(d.get("主旨", "")).strip(),
                          "desc": str(d.get("說明", "")).strip()[:1500]})
    return items


def finmind(dataset, code, start):
    url = f"https://api.finmindtrade.com/api/v4/data?dataset={dataset}&data_id={code}&start_date={start}"
    return get_json(url).get("data") or []


def fetch_revenue(code):
    start = (datetime.now(TW) - timedelta(days=800)).strftime("%Y-%m-01")
    rows = finmind("TaiwanStockMonthRevenue", code, start)
    by = {(r["revenue_year"], r["revenue_month"]): r["revenue"] for r in rows if r.get("revenue")}
    out = []
    for (y, m) in sorted(by)[-13:]:
        rev = by[(y, m)]
        last = by.get((y - 1, m))
        prev = by.get((y, m - 1) if m > 1 else (y - 1, 12))
        out.append({"ym": f"{y}-{m:02d}", "rev": rev,
                    "yoy": round(rev / last - 1, 4) if last else None,
                    "mom": round(rev / prev - 1, 4) if prev else None})
    return out


def fetch_eps(code):
    start = (datetime.now(TW) - timedelta(days=365 * 2 + 200)).strftime("%Y-%m-%d")
    rows = finmind("TaiwanStockFinancialStatements", code, start)
    q = {}
    for r in rows:
        q.setdefault(r["date"], {})[r["type"]] = r["value"]
    out = []
    for d in sorted(q)[-8:]:
        v = q[d]
        rev = v.get("Revenue")
        y, m = d[:4], int(d[5:7])
        out.append({"q": f"{y}Q{(m + 2) // 3}", "eps": v.get("EPS"),
                    "gm": round(v["GrossProfit"] / rev, 4) if rev and v.get("GrossProfit") is not None else None,
                    "opm": round(v["OperatingIncome"] / rev, 4) if rev and v.get("OperatingIncome") is not None else None})
    return out


def fetch_exdiv(codes):
    """除權除息預告表（上市＋上櫃），只留追蹤清單裡的。"""
    out = []
    sources = [
        ("https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL", "Date", "Code", "Name", "Exdividend", "CashDividend"),
        ("https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost", "ExRrightsExDividendDate", "SecuritiesCompanyCode", "CompanyName", "ExRrightsExDividend", "CashDividend"),
    ]
    for url, kd, kc, kn, kk, kcash in sources:
        try:
            data = get_json(url)
        except Exception as e:
            print("除權息預告失敗：", url, e)
            continue
        for d in data:
            code = str(d.get(kc, "")).strip()
            if code not in codes:
                continue
            kind = str(d.get(kk, "")).replace("除", "").strip() or "息"
            try:
                cash = float(str(d.get(kcash, "") or 0).replace(",", ""))
            except ValueError:
                cash = 0
            out.append({"code": code, "name": str(d.get(kn, "")).strip(), "date": roc_date(d.get(kd)), "kind": kind, "cash": round(cash, 4) or None})
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    codes = [c for c, m in watchlist() if m == "台股"]
    info = {}
    if PATH.exists():
        try:
            info = json.loads(PATH.read_text(encoding="utf-8"))
        except Exception:
            info = {}

    # 重大訊息：和舊資料合併、去重，只留 90 天
    old = info.get("news", [])
    seen = {(n["code"], n["date"], n["time"], n["title"]) for n in old}
    new = [n for n in fetch_news(set(codes)) if (n["code"], n["date"], n["time"], n["title"]) not in seen]
    cutoff = (datetime.now(TW) - timedelta(days=90)).strftime("%Y-%m-%d")
    news = sorted([n for n in old + new if n["date"] >= cutoff], key=lambda n: (n["date"], n["time"]), reverse=True)[:300]
    info["news"] = news
    print("新增重大訊息", len(new), "則")

    if mode == "all":
        rev, eps = info.get("rev", {}), info.get("eps", {})
        today = datetime.now(TW).strftime("%Y-%m-%d")
        rev_log = info.get("rev_log", [])
        for c in codes:
            try:
                r = fetch_revenue(c)
                if r:
                    old_ym = rev[c][-1]["ym"] if rev.get(c) else None
                    if old_ym and r[-1]["ym"] > old_ym:   # 這次才出現的新月份 = 新公布月營收
                        rev_log.append({"code": c, "seen": today, **r[-1]})
                    rev[c] = r
                time.sleep(0.6)
                e = fetch_eps(c)
                if e:
                    eps[c] = e
                time.sleep(0.6)
            except Exception as ex:
                print(c, "失敗：", ex)
                time.sleep(2)
        info["rev"], info["eps"] = rev, eps
        cutoff40 = (datetime.now(TW) - timedelta(days=40)).strftime("%Y-%m-%d")
        info["rev_log"] = [x for x in rev_log if x["seen"] >= cutoff40]
        try:
            info["exdiv"] = fetch_exdiv(set(codes))
            print("除權息預告", len(info["exdiv"]), "筆")
        except Exception as ex:
            print("除權息預告失敗：", ex)
        print("月營收", len(rev), "檔，季報", len(eps), "檔")

    if mode == "news" and not new and PATH.exists():
        print("沒有新公告")
        return
    info["updated"] = datetime.now(TW).isoformat(timespec="seconds")
    PATH.write_text(json.dumps(info, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
