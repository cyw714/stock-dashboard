"""抓行情，寫進 market.json，給儀表板使用。

  - 加權指數、台股個股即時價：證交所「基本市況報導」mis.twse.com.tw（上市 tse_、上櫃 otc_）
  - 台指期近月：期交所「期貨行情」mis.taifex.com.tw
  - 美股、日股，以及證交所連不上時的備援：Yahoo Finance
追蹤清單：讀 data.xlsx 的「標的清單」，名稱取「公司檔案」。
"""
import json, re, time, urllib.request, http.cookiejar
from datetime import datetime, timezone, timedelta
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
TW = timezone(timedelta(hours=8))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def http_json(url, referer=None, body=None, timeout=15):
    headers = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    if referer:
        headers["Referer"] = referer
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def num(v):
    try:
        f = float(str(v).replace(",", ""))
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


SHEET_ID = "1OdeqbHAtR8F-0Hu2zYFHeIck8Xzj7cXeEuRVWgL7M1A"  # 你的 Google 試算表
FOREIGN = {"CRDO": ("CRDO", "美股"), "ALAB": ("ALAB", "美股"), "NBIS": ("NBIS", "美股"), "KIOXIA": ("285A", "日股"),
           "瑞薩": ("6723", "日股"), "日東紡": ("3110", "日股"), "AAOI": ("AAOI", "美股"), "SANDISK": ("SNDK", "美股"),
           "SNDK": ("SNDK", "美股"), "LITE": ("LITE", "美股")}


def code_of(raw):
    t = str(raw).strip()
    if t.endswith(".0"):
        t = t[:-2]
    f = FOREIGN.get(t.upper()) or FOREIGN.get(t)
    if f:
        return f
    if re.match(r"^\d{4,6}[A-Z]?$", t):
        return t, "台股"
    return t.upper(), "美股"


def load_workbook():
    """先讀 Google 試算表，讀不到再用 data.xlsx。"""
    import io
    try:
        req = urllib.request.Request(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx", headers={"User-Agent": UA})
        with opener.open(req, timeout=30) as r:
            return openpyxl.load_workbook(io.BytesIO(r.read()), data_only=True, read_only=True)
    except Exception as e:
        print("讀不到 Google 試算表，改用 data.xlsx：", e)
        return openpyxl.load_workbook(ROOT / "data.xlsx", data_only=True, read_only=True)


def watchlist():
    """回傳 [(代號, 市場)]，已去重。支援原始格式（國內／國外）和整理過的「標的清單」。"""
    wb = load_workbook()
    items = []
    if "標的清單" in wb.sheetnames:
        rows = list(wb["標的清單"].iter_rows(values_only=True))
        h = list(rows[1])
        for r in rows[2:]:
            if r[h.index("代號")] and (r[h.index("分類")] if "分類" in h else None) != "已出場":
                items.append((code_of(r[h.index("代號")])[0], r[h.index("市場")] or "台股"))
    for name in ("國內", "國外"):
        if name in wb.sheetnames:
            for r in list(wb[name].iter_rows(values_only=True))[1:]:
                a = r[0] if r else None
                if a is None or str(a).strip() == "" or "今日" in str(a):
                    continue
                items.append(code_of(a))
    out, seen = [], set()
    for c, m in items:
        if c.upper() not in seen:
            seen.add(c.upper())
            out.append((c, m))
    return out


def from_mis(codes):
    """證交所即時：回傳 (指數 (價, 昨收), {代號: (價, 昨收)})"""
    try:
        opener.open(urllib.request.Request("https://mis.twse.com.tw/stock/index.jsp", headers={"User-Agent": UA}), timeout=15).read()
    except Exception:
        pass
    chans = ["tse_t00.tw"] + [f"{ex}_{c}.tw" for c in codes for ex in ("tse", "otc")]
    idx, stocks = None, {}
    for i in range(0, len(chans), 40):
        url = ("https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&_=%d&ex_ch=" % int(time.time() * 1000)) + "|".join(chans[i:i + 40])
        data = http_json(url, referer="https://mis.twse.com.tw/stock/index.jsp")
        for m in data.get("msgArray", []):
            price = num(m.get("z"))
            if price is None:  # 剛好沒成交時，用最佳買價代替
                price = num((m.get("b") or "").split("_")[0])
            prev = num(m.get("y"))
            if m.get("c") == "t00":
                idx = (price, prev)
            elif m.get("c") in codes:
                stocks[m["c"]] = (price, prev)
        time.sleep(1)
    return idx, stocks


def yahoo(symbol):
    d = http_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d")
    meta = d["chart"]["result"][0]["meta"]
    return num(meta.get("regularMarketPrice")), num(meta.get("chartPreviousClose") or meta.get("previousClose"))


def futures_txf():
    """台指期近月：先抓一般交易時段，沒有價格再抓盤後時段。"""
    for market_type in ("0", "1"):
        body = {"MarketType": market_type, "SymbolType": "F", "KindID": "1", "CID": "TXF",
                "ExpireMonth": "", "RowSize": "全部", "PageNo": "", "SortColumn": "", "AscDesc": "A"}
        d = http_json("https://mis.taifex.com.tw/futures/api/getQuoteList", referer="https://mis.taifex.com.tw/futures/", body=body)
        items = ((d.get("RtData") or {}).get("QuoteList")) or []
        months = [q for q in items if re.match(r"^TXF[A-L]\d", str(q.get("SymbolID", "")))]
        if not months:
            continue
        q = months[0]  # 清單依到期月排序，第一個就是近月
        price, ref = num(q.get("CLastPrice")), num(q.get("CRefPrice"))
        if price and ref:
            return {"value": round(price, 0), "change": round(price - ref, 0), "pct": round(price / ref - 1, 5),
                    "label": "夜盤" if market_type == "1" else ""}
    return None


def main():
    wl = watchlist()
    tw_codes = [c for c, m in wl if m == "台股"]
    idx, tw = None, {}
    try:
        idx, tw = from_mis(tw_codes)
    except Exception as e:
        print("證交所即時資料失敗，改用 Yahoo：", e)
    if not idx or not idx[0] or not idx[1]:
        try:
            idx = yahoo("%5ETWII")
        except Exception as e:
            print("指數備援失敗：", e)

    quotes = {}
    for code, mkt in wl:
        price = prev = None
        if mkt == "台股":
            price, prev = tw.get(code, (None, None))
            symbols = [] if (price and prev) else [code + ".TW", code + ".TWO"]
        elif mkt == "日股":
            symbols = [code + ".T"]
        else:
            symbols = [code]
        for sym in symbols:
            try:
                price, prev = yahoo(sym)
                if price and prev:
                    break
            except Exception:
                price = prev = None
        if price and prev:
            quotes[code.upper()] = {"price": round(price, 2), "prev": round(prev, 2), "pct": round(price / prev - 1, 5)}

    out = {"updated": datetime.now(TW).isoformat(timespec="seconds"), "time_label": datetime.now(TW).strftime("%m/%d %H:%M")}
    if idx and idx[0] and idx[1]:
        p, y = idx
        out["index"] = {"value": round(p, 2), "change": round(p - y, 2), "pct": round(p / y - 1, 5)}
    try:
        f = futures_txf()
        if f:
            out["futures"] = f
    except Exception as e:
        print("台指期失敗：", e)
    def yq(sym, digits=2):
        try:
            p, y = yahoo(sym)
            if p and y:
                return {"value": round(p, digits), "change": round(p - y, digits), "pct": round(p / y - 1, 5)}
        except Exception as e:
            print(sym, "失敗：", e)
        return None
    out["nasdaq"] = {"index": yq("%5EIXIC"), "fut": yq("NQ%3DF", 0)}
    out["sox"] = yq("%5ESOX")
    out["quotes"] = quotes

    path = ROOT / "market.json"
    old = {}
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    if "index" not in out and not quotes and old.get("index"):
        print("這次沒抓到資料，保留上一次的行情")
        return
    for k in ("index", "futures", "sox"):  # 這次沒抓到的項目沿用上一次
        if k not in out and old.get(k):
            out[k] = old[k]
    strip = lambda d: {k: v for k, v in d.items() if k not in ("updated", "time_label")}
    if strip(out) == strip(old):
        print("行情沒有變動")
        return
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("指數", out.get("index"), "台指期", out.get("futures"), "個股", len(quotes), "檔")


if __name__ == "__main__":
    main()
