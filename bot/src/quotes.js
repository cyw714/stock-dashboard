// quotes.js — 抓即時行情
//   台股：證交所「基本市況報導」mis.twse.com.tw（上市 tse_、上櫃 otc_ 都問一次，哪個有回應就是哪個）
//   日股、美股、國際指數：Yahoo Finance
//   台指期：期交所 mis.taifex.com.tw
// 每一個來源失敗都不會讓整支程式停下來，只會少了那幾檔的價格。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function getJSON(url, { headers = {}, body, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 台股即時價
 * @returns {{ index: Quote|null, stocks: Object<string, Quote>, tradeDate: string|null }}
 *   Quote = { price, prev, name, pct }；tradeDate 是行情的日期（例如 "20261117"），用來判斷今天有沒有開盤
 */
export async function twQuotes(codes) {
  // 先開一次首頁拿 cookie，證交所有時候沒有 cookie 會不回資料
  let cookie = '';
  try {
    const r = await fetch('https://mis.twse.com.tw/stock/index.jsp', { headers: { 'User-Agent': UA } });
    cookie = (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  } catch { /* 拿不到 cookie 也試試看 */ }

  const chans = ['tse_t00.tw', ...codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`])];
  const out = { index: null, stocks: {}, tradeDate: null };
  for (let i = 0; i < chans.length; i += 40) {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&_=${Date.now()}&ex_ch=${chans.slice(i, i + 40).join('|')}`;
    // 每一批最多試 3 次：證交所偶爾會擋太頻繁的請求
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const data = await getJSON(url, { headers: { Referer: 'https://mis.twse.com.tw/stock/index.jsp', ...(cookie ? { Cookie: cookie } : {}) } });
        if (!data.msgArray) throw new Error('沒有資料');
        for (const m of data.msgArray) {
          // z 是最新成交價；剛好沒有成交時用最佳買價代替；都沒有就用開盤價
          const price = num(m.z) ?? num((m.b ?? '').split('_')[0]) ?? num(m.o);
          const prev = num(m.y);
          const q = { price, prev, name: m.n, pct: price && prev ? price / prev - 1 : null };
          if (m.c === 't00') { out.index = q; out.tradeDate = m.d ?? null; }
          else if (codes.includes(m.c)) out.stocks[m.c] = q;
        }
        break;
      } catch (e) {
        console.warn(`證交所行情第 ${attempt} 次失敗：`, e.message);
        await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
    if (i + 40 < chans.length) await new Promise(r => setTimeout(r, 600));
  }
  // 證交所還是缺的（例如被擋、興櫃股票），改問 Yahoo：先試上市 .TW，再試上櫃 .TWO
  const missing = codes.filter(c => !out.stocks[c] || out.stocks[c].price == null && out.stocks[c].prev == null);
  if (missing.length) {
    const tryY = async c => (await yahooQuote(`${c}.TW`)) ?? (await yahooQuote(`${c}.TWO`));
    const got = await Promise.all(missing.map(tryY));
    missing.forEach((c, k) => { if (got[k]?.price) out.stocks[c] = { ...got[k], name: out.stocks[c]?.name ?? null, source: 'yahoo' }; });
  }
  return out;
}

// Yahoo 的代號：日股要加 .T，台股加 .TW / .TWO
export function yahooSymbol(item) {
  if (item.market === '日股') return `${item.code}.T`;
  return item.code;
}

export async function yahooQuote(symbol) {
  try {
    const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
    const meta = d.chart.result[0].meta;
    const price = num(meta.regularMarketPrice), prev = num(meta.chartPreviousClose ?? meta.previousClose);
    return { price, prev, name: meta.shortName ?? symbol, pct: price && prev ? price / prev - 1 : null };
  } catch (e) {
    console.warn(`Yahoo ${symbol} 失敗：`, e.message);
    return null;
  }
}

export async function yahooQuotes(symbols) {
  const res = await Promise.all(symbols.map(yahooQuote));
  return Object.fromEntries(symbols.map((s, i) => [s, res[i]]));
}

// 台指期近月：先抓一般盤，沒有價格再抓夜盤
export async function txfQuote() {
  for (const marketType of ['0', '1']) {
    try {
      const d = await getJSON('https://mis.taifex.com.tw/futures/api/getQuoteList', {
        headers: { Referer: 'https://mis.taifex.com.tw/futures/' },
        body: { MarketType: marketType, SymbolType: 'F', KindID: '1', CID: 'TXF', ExpireMonth: '', RowSize: '全部', PageNo: '', SortColumn: '', AscDesc: 'A' },
      });
      const list = (d?.RtData?.QuoteList ?? []).filter(q => /^TXF[A-L]\d/.test(String(q.SymbolID ?? '')));
      const q = list[0];
      const price = num(q?.CLastPrice), ref = num(q?.CRefPrice);
      if (price && ref) return { price, prev: ref, pct: price / ref - 1, night: marketType === '1' };
    } catch (e) {
      console.warn('期交所行情失敗：', e.message);
    }
  }
  return null;
}

/**
 * 一次抓齊清單上所有標的的價格
 * @param {Array} items  sheet.js 的標的清單
 * @param {{ foreign?: boolean }} opt  foreign=false 時只抓台股和日股（盤中到價用，美股這時候沒有開）
 */
export async function quotesFor(items, { foreign = true } = {}) {
  const tw = items.filter(x => x.market === '台股').map(x => x.code);
  const others = items.filter(x => x.market === '日股' || (foreign && x.market === '美股'));
  const [t, y] = await Promise.all([twQuotes(tw), yahooQuotes(others.map(yahooSymbol))]);
  const prices = { ...t.stocks };
  for (const x of others) if (y[yahooSymbol(x)]) prices[x.code] = y[yahooSymbol(x)];
  if (t.index) prices.TAIEX = t.index;
  return { prices, tradeDate: t.tradeDate };
}
