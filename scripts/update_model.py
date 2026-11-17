"""每天收盤後計算「模型參考評分」和「到價機率」需要的數字，寫進 model.json。

評分（保守版，0–10 分）——我們一起定的八個分項：
  ① 季線位置 25%  ② 月線位置 10%  ③ 漲跌量比 10%  ④ 量能變化 10%
  ⑤ 外資 15%      ⑥ 投信 10%      ⑦ 融資 5%       ⑧ 波動風險 15%
  美股、日股沒有法人和融資資料，⑤⑥⑦ 拿掉，其他照比例放大。
  四道保守關卡：
    1. 短板懲罰：0.7 × 加權平均 + 0.3 × 最低分項
    2. 跌破季線 → 最高 6 分
    3. 外資、投信同時連賣 5 天以上 → 最高 6 分
    4. 跌破季線且季線下彎 → 最高 4.5 分
    最後無條件捨去到 0.5

到價機率：這裡只算「坡度」和「晃動」兩個數字，
  坡度 mu  = ln(月線 / 季線) / 40，上坡打五折、下坡照算（每天）
  晃動 sig = max(近 20 日, 近 60 日) 日報酬標準差
網站和 stockie 拿現價、買點、目標價，用同一條公式即時算出 20／60 天內碰到的機率。

資料來源：台股日線、法人、融資用 FinMind；美股、日股日線用 Yahoo Finance。
"""
import json, math, time, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from update_market import watchlist, TW, UA

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "model.json"
WEIGHTS = {"季線位置": 25, "月線位置": 10, "漲跌量比": 10, "量能變化": 10, "外資": 15, "投信": 10, "融資": 5, "波動風險": 15}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def finmind(dataset, code, days):
    start = (datetime.now(TW) - timedelta(days=days)).strftime("%Y-%m-%d")
    url = f"https://api.finmindtrade.com/api/v4/data?dataset={dataset}&data_id={code}&start_date={start}"
    for i in range(3):
        try:
            return get_json(url).get("data") or []
        except Exception as e:
            print(f"  FinMind {dataset} {code} 第 {i + 1} 次失敗：{e}")
            time.sleep(5)
    return []


# ---------- 抓資料 ----------
def tw_history(code):
    rows = finmind("TaiwanStockPrice", code, 200)
    return [(r["date"], float(r["close"]), float(r["Trading_Volume"])) for r in rows if r.get("close")]


def tw_chips(code):
    """回傳 (外資近10日買賣超股數, 投信近10日, 外資連續買賣天數, 投信連續天數, 融資20日變化%)"""
    inst = finmind("TaiwanStockInstitutionalInvestorsBuySell", code, 40)
    by = {}
    for r in inst:
        d = by.setdefault(r["date"], {"f": 0, "t": 0})
        net = (r.get("buy") or 0) - (r.get("sell") or 0)
        if r["name"] in ("Foreign_Investor", "Foreign_Dealer_Self"):
            d["f"] += net
        elif r["name"] == "Investment_Trust":
            d["t"] += net
    days = sorted(by)[-10:]

    def streak(key):  # 正數 = 連買幾天，負數 = 連賣幾天
        n, sign = 0, 0
        for d in reversed(sorted(by)):
            v = by[d][key]
            s = (v > 0) - (v < 0)
            if s == 0 or (sign and s != sign):
                break
            sign, n = s, n + 1
        return n * sign

    margin = finmind("TaiwanStockMarginPurchaseShortSale", code, 45)
    bal = [r["MarginPurchaseTodayBalance"] for r in margin if r.get("MarginPurchaseTodayBalance") is not None]
    mg = (bal[-1] / bal[-21] - 1) * 100 if len(bal) >= 21 and bal[-21] else None
    return (sum(by[d]["f"] for d in days), sum(by[d]["t"] for d in days), streak("f"), streak("t"), mg)


def yahoo_history(symbol):
    d = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1y&interval=1d")
    r = d["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    out = []
    for t, c, v in zip(r["timestamp"], q["close"], q["volume"]):
        if c:
            out.append((datetime.fromtimestamp(t, TW).strftime("%Y-%m-%d"), float(c), float(v or 0)))
    return out


# ---------- 計算 ----------
def ma(xs, n, end=None):
    xs = xs[:end] if end else xs
    return sum(xs[-n:]) / n if len(xs) >= n else None


def stdev(xs):
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def lin(x, a, b):
    return max(0.0, min(10.0, (x - a) / (b - a) * 10))


def pos_score(d, full):  # 股價離均線 d%；離太遠（漲過頭）會扣分
    if d < -10: return 0.0
    if d < 0: return 5 * (1 + d / 10)
    if d <= full: return 5 + 5 * d / full
    return max(6.0, 10 - (d - full) * 4 / 17)


def analyze(hist, chips=None):
    closes = [c for _, c, _ in hist]
    vols = [v for _, _, v in hist]
    if len(closes) < 70:
        return None
    p = closes[-1]
    ma20, ma60 = ma(closes, 20), ma(closes, 60)
    ma60_10 = ma(closes, 60, end=-10)
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    s20, s60 = stdev(rets[-20:]), stdev(rets[-60:])
    sig = max(s20, s60)
    vol_ann = s20 * math.sqrt(252) * 100

    d60, d20 = (p / ma60 - 1) * 100, (p / ma20 - 1) * 100
    up = [vols[i] for i in range(len(closes) - 20, len(closes)) if closes[i] > closes[i - 1]]
    dn = [vols[i] for i in range(len(closes) - 20, len(closes)) if closes[i] < closes[i - 1]]
    vr = (sum(up) / len(up)) / (sum(dn) / len(dn)) if up and dn and sum(dn) else 1.0
    v5 = (ma(vols, 5) / ma(vols, 20)) if ma(vols, 20) else 1.0
    p5 = (p / closes[-6] - 1) * 100
    p20 = (p / closes[-21] - 1) * 100

    f, raw = {}, {}
    f["季線位置"], raw["季線位置"] = pos_score(d60, 8), f"{'高' if d60 >= 0 else '低'}於季線 {d60:+.1f}%（季線 {ma60:,.1f}）"
    f["月線位置"], raw["月線位置"] = pos_score(d20, 5), f"{'高' if d20 >= 0 else '低'}於月線 {d20:+.1f}%（月線 {ma20:,.1f}）"
    f["漲跌量比"], raw["漲跌量比"] = lin(vr, 0.7, 1.3), f"上漲日量 ÷ 下跌日量 = {vr:.2f}"
    if p5 > 0:
        f["量能變化"] = min(10.0, 5 + max(0.0, v5 - 1) * 10) if v5 >= 1 else 5.0
    else:
        f["量能變化"] = max(0.0, 5 - (v5 - 1) * 10) if v5 >= 1 else 5 + (1 - v5) * 3
    raw["量能變化"] = f"5 日 ÷ 20 日量 {v5:.2f}，近 5 日{'上漲' if p5 > 0 else '下跌'} {p5:+.1f}%"
    gates, cap = [], 10.0
    if chips:
        fnet, tnet, fst, tst, mg = chips
        vol10 = sum(vols[-10:]) or 1
        fi, it = fnet / vol10 * 100, tnet / vol10 * 100
        f["外資"], raw["外資"] = lin(fi, -10, 10), f"近 10 日{'買' if fi >= 0 else '賣'}超 {abs(fi):.1f}%，連{'買' if fst >= 0 else '賣'} {abs(fst)} 天"
        f["投信"], raw["投信"] = lin(it, -10, 10), f"近 10 日{'買' if it >= 0 else '賣'}超 {abs(it):.1f}%，連{'買' if tst >= 0 else '賣'} {abs(tst)} 天"
        if mg is not None:
            # 股價跌、融資增加 = 散戶接刀（扣分）；融資減少 = 籌碼變乾淨（加分）
            f["融資"] = max(0.0, min(10.0, 5 - mg))
            raw["融資"] = f"近 20 日 {mg:+.1f}%，" + ("籌碼變乾淨" if mg < 0 else "散戶接刀" if p20 < 0 else "融資增加")
        if fst <= -5 and tst <= -5:
            cap = min(cap, 6.0); gates.append("外資＋投信連賣 5 天以上 → 最高 6")
    f["波動風險"], raw["波動風險"] = lin(-vol_ann, -60, -20), f"年化 {vol_ann:.1f}%"

    keys = [k for k in WEIGHTS if k in f]
    tot = sum(WEIGHTS[k] for k in keys)
    avg = sum(f[k] * WEIGHTS[k] for k in keys) / tot
    low_k = min(keys, key=lambda k: f[k])
    pen = 0.7 * avg + 0.3 * f[low_k]
    if d60 < 0:
        cap = min(cap, 6.0); gates.append("跌破季線 → 最高 6")
    if d60 < 0 and ma60_10 and ma60 < ma60_10:
        cap = min(cap, 4.5); gates.append("跌破季線且季線下彎 → 最高 4.5")
    final = math.floor(min(pen, cap) * 2) / 2

    mu_raw = math.log(ma20 / ma60) / 40
    mu = mu_raw * 0.5 if mu_raw > 0 else mu_raw
    return {
        "asof": hist[-1][0], "close": round(p, 4), "ma20": round(ma20, 4), "ma60": round(ma60, 4),
        "score": final,
        "factors": [{"k": k, "w": WEIGHTS[k], "s": round(f[k], 1), "d": raw[k]} for k in keys],
        "calc": {"avg": round(avg, 2), "low": low_k, "lowScore": round(f[low_k], 1), "penalized": round(pen, 2),
                 "cap": cap, "gates": gates},
        "prob": {"muRaw": mu_raw, "mu": mu, "sigma": sig, "volAnn": round(vol_ann, 1)},
    }


def main():
    out = {}
    for code, market in watchlist():
        if code == "TAIEX":
            continue
        print(f"{code}（{market}）")
        try:
            if market == "台股":
                hist = tw_history(code)
                chips = tw_chips(code) if hist else None
            else:
                sym = f"{code}.T" if market == "日股" else code
                hist, chips = yahoo_history(sym), None
            r = analyze(hist, chips)
            if r:
                out[code] = r
                print(f"  模型評分 {r['score']}，晃動 {r['prob']['sigma'] * 100:.2f}%/天")
            else:
                print("  資料不足（少於 70 天），略過")
        except Exception as e:
            print("  失敗：", e)
        time.sleep(0.5)
    OUT.write_text(json.dumps({"updated": datetime.now(TW).isoformat(timespec="seconds"), "stocks": out},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"完成：{len(out)} 檔")


if __name__ == "__main__":
    main()
