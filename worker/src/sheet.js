// sheet.js — 讀取 Google 試算表的標的清單，轉成程式好用的格式
//
// 資料流程：Google 試算表（國內、國外分頁）→ 下載成 Excel 檔 → 這支程式解析 → 一份統一的「標的清單」
// 網站和 LINE 通知都用同一份清單，所以只要改試算表，兩邊都會跟著變。

import { readXlsx, isSeparator } from './xlsx.js';

export const SHEET_ID = '1OdeqbHAtR8F-0Hu2zYFHeIck8Xzj7cXeEuRVWgL7M1A';

// 非台股代號的對照表（試算表裡寫的名字 → 真正的交易代號）
const FOREIGN = {
  'crdo': { code: 'CRDO', name: 'Credo', market: '美股' },
  'alab': { code: 'ALAB', name: 'Astera Labs', market: '美股' },
  'nbis': { code: 'NBIS', name: 'Nebius', market: '美股' },
  'aaoi': { code: 'AAOI', name: 'Applied Opto', market: '美股' },
  'sandisk': { code: 'SNDK', name: 'Sandisk', market: '美股' },
  'lite': { code: 'LITE', name: 'Lumentum', market: '美股' },
  'kioxia': { code: '285A', name: 'Kioxia', market: '日股' },
  '瑞薩': { code: '6723', name: '瑞薩', market: '日股' },
  '日東紡': { code: '3110', name: '日東紡', market: '日股' },
};

// ---------- 1. CSV 解析 ----------
// 處理引號、逗號、換行（例如 "25%,25%,50%" 這種格子裡本身有逗號的情況）
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- 2. 價位解讀 ----------
// 把「23X」「<550」「185-187」「195附近」這些寫法，轉成一個區間 {lo, hi}
//   當買點：股價 ≤ hi 就算進區（碰到區間上緣）
//   當目標價：股價 ≥ lo 就算到（碰到區間下緣）
// raw 保留原本的寫法，畫面上照你寫的顯示
export function parseLevel(v) {
  if (v === undefined || v === null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const s = raw.replace(/,/g, '').replace(/\s/g, '');
  let m;
  // 純數字：870、52.6
  if ((m = s.match(/^\d+(\.\d+)?$/))) { const n = +s; return { raw, lo: n, hi: n }; }
  // X 結尾：23X → 230~239、46XX → 4600~4699
  if ((m = s.match(/^(\d+)([Xx]+)$/))) {
    const k = 10 ** m[2].length, base = +m[1] * k;
    return { raw, lo: base, hi: base + k - 1 };
  }
  // 小於：<550
  if ((m = s.match(/^[<＜](\d+(\.\d+)?)$/))) { const n = +m[1]; return { raw, lo: n, hi: n }; }
  // 區間：185-187、215~217、6100-5800（大小順序不拘）
  if ((m = s.match(/^(\d+(\.\d+)?)[-~～](\d+(\.\d+)?)$/))) {
    const a = +m[1], b = +m[3];
    return { raw, lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  // 附近：195附近 → 193.05~196.95（±1%）
  if ((m = s.match(/^(\d+(\.\d+)?)附近$/))) {
    const n = +m[1];
    return { raw, lo: n * 0.99, hi: n * 1.01 };
  }
  // 看不懂的寫法：保留原文，但不拿來判斷到價
  return { raw, lo: null, hi: null, unknown: true };
}

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ---------- 3. 國內分頁 ----------
// 欄位：A 代號、B 備註、C 買點1、D 買點2、E 超級好買點、F~H TP1~3、I 市值、J~L 評分
// 分組：灰色分隔列以上是「重點觀察」，以下是「其他追蹤」（fills 是每列 A 欄的底色）
export function parseDomestic(rows, foreignCodes = new Set(), fills = []) {
  const out = [], seen = new Set();
  let group = '重點觀察';
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const a = (r[0] || '').trim();
    if (isSeparator(r, fills[i])) { group = '其他追蹤'; continue; }
    if (!a) continue;                                   // 空白列：排版用，跳過
    if (a.includes('今日') || a.includes('重點')) { group = '重點觀察'; continue; }
    if (a.includes('其他追蹤')) { group = '其他追蹤'; continue; }

    const isIndex = a === '大盤';
    const f = FOREIGN[a.toLowerCase()] || FOREIGN[a];
    if (f && foreignCodes.has(f.code)) continue;       // 「國外」分頁也有的，以「國外」為準
    const code = isIndex ? 'TAIEX' : f ? f.code : a.replace(/\.0$/, '');
    if (seen.has(code)) continue;                       // 重複的股票：以比較上面那列為準
    seen.add(code);
    out.push(makeItem({
      code, name: isIndex ? '加權指數' : f ? f.name : null, market: isIndex ? '指數' : f ? f.market : '台股', group,
      note: r[1], b1: r[2], b2: r[3], sb: r[4], tp1: r[5], tp2: r[6], tp3: r[7],
      mcap: r[8], tech: r[9], conf: r[10], fund: r[11],
    }));
  }
  return out;
}

// ---------- 4. 國外分頁 ----------
// 欄位：A 名稱、B 買點1、C 買點2、D 超級好買點、E~G TP1~3
export function parseForeign(rows) {
  const out = [], seen = new Set();
  for (const r of rows.slice(1)) {
    const a = (r[0] || '').trim();
    if (!a) continue;
    const f = FOREIGN[a.toLowerCase()] || FOREIGN[a] || { code: a.toUpperCase(), name: a, market: '美股' };
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    out.push(makeItem({
      code: f.code, name: f.name, market: f.market, group: '其他追蹤',
      b1: r[1], b2: r[2], sb: r[3], tp1: r[4], tp2: r[5], tp3: r[6],
    }));
  }
  return out;
}

function makeItem(x) {
  const tech = num(x.tech), conf = num(x.conf), fund = num(x.fund);
  return {
    code: x.code, name: x.name, market: x.market, group: x.group,
    note: (x.note || '').trim() || null,
    buy: { b1: parseLevel(x.b1), b2: parseLevel(x.b2), sb: parseLevel(x.sb) },
    tp: { tp1: parseLevel(x.tp1), tp2: parseLevel(x.tp2), tp3: parseLevel(x.tp3) },
    scores: {
      tech, conf, fund,
      // 三項都有填才算平均
      avg: tech != null && conf != null && fund != null ? +((tech + conf + fund) / 3).toFixed(2) : null,
    },
  };
}

// ---------- 5. 到價判斷 ----------
// 回傳現在在哪一區：sb（超級好買點）、b2、b1、tp3、tp2、tp1，或 null
export function zoneOf(item, price) {
  if (price == null) return null;
  const { b1, b2, sb } = item.buy, { tp1, tp2, tp3 } = item.tp;
  const below = L => L && L.hi != null && price <= L.hi;
  const above = L => L && L.lo != null && price >= L.lo;
  if (above(tp3)) return 'tp3';
  if (above(tp2)) return 'tp2';
  if (above(tp1)) return 'tp1';
  if (below(sb)) return 'sb';
  if (below(b2)) return 'b2';
  if (below(b1)) return 'b1';
  return null;
}

// ---------- 6. 從 Google 下載 ----------
// 下載整份試算表（Excel 格式），一次拿到所有分頁和底色
export async function loadWatchlist() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`讀取試算表失敗：HTTP ${res.status}`);
  return parseWorkbook(new Uint8Array(await res.arrayBuffer()));
}

export function parseWorkbook(bytes) {
  const book = readXlsx(bytes);
  if (!book['國內'] || !book['國外']) throw new Error('找不到「國內」或「國外」分頁，分頁名稱是不是被改了？');
  const foreign = parseForeign(book['國外'].rows);
  const domestic = parseDomestic(book['國內'].rows, new Set(foreign.map(x => x.code)), book['國內'].fills);
  return [...domestic, ...foreign];
}
