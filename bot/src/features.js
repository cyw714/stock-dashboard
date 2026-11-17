// features.js — 加值功能：試算表異動、LINE 查股、自訂提醒、每週回顧

import * as store from './store.js';
import * as line from './line.js';
import * as M from './messages.js';
import { quotesFor, twQuotes } from './quotes.js';
import { hitP, fprob, modelData, todayLeft } from './prob.js';
import { tpeDate, tpeMinutes } from './time.js';

const fp = M.fmtPrice;
const shortDate = d => d.slice(5).replace('-', '/');

// ========== 1. 試算表異動 ==========
// 把清單壓成「代號 → 重要欄位」，方便比較
function snapshot(items) {
  return Object.fromEntries(items.map(x => [x.code, {
    name: x.name ?? null, group: x.group,
    b1: x.buy.b1?.raw ?? null, b2: x.buy.b2?.raw ?? null, sb: x.buy.sb?.raw ?? null,
    tp1: x.tp.tp1?.raw ?? null, tp2: x.tp.tp2?.raw ?? null, tp3: x.tp.tp3?.raw ?? null,
    tech: x.scores.tech ?? null, note: x.note ?? null,
  }]));
}

const FIELD = { b1: '買點1', b2: '買點2', sb: '超級好買點', tp1: 'TP1', tp2: 'TP2', tp3: 'TP3' };

export function diffSnapshots(prev, cur, names = {}) {
  const items = [];
  const nm = c => `${c} ${names[c] ?? cur[c]?.name ?? prev[c]?.name ?? ''}`.trim();
  const added = Object.keys(cur).filter(c => !prev[c]), removed = Object.keys(prev).filter(c => !cur[c]);
  if (added.length) items.push({ kind: 'add', order: 0, text: added.map(nm).join('、') });
  if (removed.length) items.push({ kind: 'remove', order: 1, text: removed.map(nm).join('、') });
  for (const c of Object.keys(cur).filter(c => prev[c])) {
    const a = prev[c], b = cur[c];
    for (const f of Object.keys(FIELD)) {
      if (a[f] !== b[f]) items.push({ kind: 'level', order: 2, text: `${nm(c)}　${FIELD[f]} ${a[f] ?? '（空白）'} → ${b[f] ?? '（刪除）'}` });
    }
    if (a.group !== b.group) items.push({ kind: 'group', order: 3, text: `${nm(c)}　${a.group} → ${b.group}` });
    if (a.tech !== b.tech) items.push({ kind: 'score', order: 4, text: `${nm(c)}　技術評分 ${a.tech ?? '—'} → ${b.tech ?? '—'}` });
  }
  return items.sort((x, y) => x.order - y.order);
}

// 晨報時呼叫：和上一份比對，存下這次的版本。回傳 { since, until, items }
export async function sheetDiff(items, names, { save = true } = {}) {
  const cur = snapshot(items);
  const prev = await store.get('cache/sheetSnapshot');
  const today = tpeDate();
  if (!prev?.data) {
    await store.set('cache/sheetSnapshot', { data: cur, date: today }, false);  // 第一次：先存一份當比較基準
    return null;  // 第一次：還沒有可以比的
  }
  const result = { since: shortDate(prev.date), until: shortDate(today), items: diffSnapshots(prev.data, cur, names) };
  if (save && prev.date !== today) {
    await store.set('cache/sheetSnapshot', { data: cur, date: today }, false);
    await store.set('cache/sheetDiff', result, false);
  }
  return result;
}

export async function lastDiff() {
  return M.diffMessage(await store.get('cache/sheetDiff'));
}

// ========== 2. LINE 查股 ==========
// 用代號或名稱找清單裡的股票
export function findItem(items, q) {
  const s = q.trim().toUpperCase();
  return items.find(x => x.code.toUpperCase() === s) ?? items.find(x => x.name && (x.name === q.trim() || x.name.replace(/-KY|-創/, '') === q.trim()));
}

export async function lookup(rows, q) {
  const md = await modelData();
  let x = findItem(rows, q);
  if (!x && /^\d{4,6}[A-Z]?$/.test(q.trim())) {
    // 不在觀察名單：只回價格
    const t = await twQuotes([q.trim()]);
    const p = t.stocks[q.trim()];
    if (!p) return M.textMessage(`查不到 ${q.trim()} 的報價，代號是不是打錯了？`);
    return M.stockCard({ code: q.trim(), name: p.name, market: '台股', price: p.price ?? p.prev, pct: p.pct, rows: [['觀察名單', '不在名單內']] });
  }
  if (!x) return null;
  const m = md[x.code];
  let price = x.price, stale = null;
  if (price == null && m) { price = m.close; stale = `${shortDate(m.asof)} 收盤`; }
  const buyHi = [x.buy.b1, x.buy.b2, x.buy.sb].find(L => L?.hi != null)?.hi;
  const best = x.buy.sb ?? x.buy.b2 ?? x.buy.b1;
  const info = [
    ['技術評分', x.scores.tech != null ? x.scores.tech.toFixed(1) : '—'],
    ['模型參考', m ? m.score.toFixed(1) : '—'],
  ];
  if (m && price) {
    const d = todayLeft(x.market);
    const P = (L, T) => fprob(hitP(price, L, m.prob.mu, m.prob.sigma, T));
    const targets = [];
    if (buyHi && price > buyHi) targets.push(['買點1', buyHi]);
    if (x.buy.sb?.hi && price > x.buy.sb.hi && x.buy.sb.hi !== buyHi) targets.push(['超級好買點', x.buy.sb.hi]);
    if (x.tp.tp1?.lo) targets.push(['TP1', x.tp.tp1.lo]);
    for (const [k, L] of targets.slice(0, 2)) info.push([`到${k}（${d.label}／5天）`, `${P(L, d.T)}／${P(L, 5)}`]);
  }
  info.push(['最佳買點', best?.raw ?? '—'], ['TP1', x.tp.tp1?.raw ?? '—']);
  return M.stockCard({ ...x, price, stale, inList: true, rows: info });
}

// ========== 3. 自訂提醒 ==========
const MAX_PER_USER = 10;

export async function addCustom(userId, rows, codeOrName, priceText) {
  const x = findItem(rows, codeOrName);
  const code = x?.code ?? codeOrName.trim().toUpperCase();
  const target = parseFloat(priceText.replace(/,/g, ''));
  if (!Number.isFinite(target) || target <= 0) return '價格看不懂，請打像這樣：提醒 3037 700';
  let now = x?.price;
  if (now == null && /^\d{4,6}[A-Z]?$/.test(code)) { const t = await twQuotes([code]); now = t.stocks[code]?.price ?? t.stocks[code]?.prev; }
  if (now == null) return `查不到 ${code} 的現價，沒辦法設定提醒。`;
  const mine = await store.query('custom', [['userId', '==', userId], ['active', '==', true]]);
  if (mine.length >= MAX_PER_USER) return `每個人最多 ${MAX_PER_USER} 個提醒，請先「取消提醒 代號」。`;
  const dir = target < now ? 'below' : 'above';
  await store.add('custom', { userId, code, name: x?.name ?? null, target, dir, created: new Date().toISOString(), active: true });
  return `✅ 已設定：${x?.name ?? code} ${dir === 'below' ? '跌到' : '漲到'} ${fp(target)} 時通知你（現在 ${fp(now)}）。\n只在盤中檢查，每 5 分鐘一次，碰到一次就自動取消。`;
}

export async function listCustom(userId) {
  const mine = await store.query('custom', [['userId', '==', userId], ['active', '==', true]]);
  if (!mine.length) return '你目前沒有設定提醒。設定方式：提醒 3037 700';
  return '你的提醒：\n' + mine.map(a => `• ${a.name ?? a.code} ${a.dir === 'below' ? '跌到' : '漲到'} ${fp(a.target)}`).join('\n') + '\n\n取消：取消提醒 代號';
}

export async function cancelCustom(userId, rows, codeOrName) {
  const code = findItem(rows, codeOrName)?.code ?? codeOrName.trim().toUpperCase();
  const mine = (await store.query('custom', [['userId', '==', userId], ['active', '==', true]])).filter(a => a.code === code);
  for (const a of mine) await store.set(`custom/${a.id}`, { active: false, cancelled: new Date().toISOString() });
  return mine.length ? `已取消 ${code} 的 ${mine.length} 個提醒。` : `你沒有 ${code} 的提醒。`;
}

// 盤中每 5 分鐘由看門狗呼叫
export async function checkCustom(watchlist) {
  const now = tpeMinutes();
  if (now < 9 * 60 || now > 13 * 60 + 35) return [];
  const active = await store.query('custom', [['active', '==', true]]);
  if (!active.length) return [];
  const codes = [...new Set(active.map(a => a.code))];
  const items = codes.map(c => watchlist.find(x => x.code === c) ?? { code: c, market: /^\d/.test(c) ? '台股' : '美股' });
  const { prices } = await quotesFor(items, { foreign: false });
  const fired = [];
  for (const a of active) {
    const p = prices[a.code]?.price;
    if (p == null) continue;
    if ((a.dir === 'below' && p <= a.target) || (a.dir === 'above' && p >= a.target)) {
      try {
        await line.pushTo(a.userId, M.textMessage(`🔔 ${a.name ?? a.code} 已${a.dir === 'below' ? '跌到' : '漲到'} ${fp(p)}（你設的提醒：${fp(a.target)}）`));
        await store.set(`custom/${a.id}`, { active: false, firedAt: new Date().toISOString(), firedPrice: p });
        fired.push(a.code);
      } catch (e) { console.warn('自訂提醒發送失敗：', e.message); }
    }
  }
  return fired;
}

// ========== 4. 每週回顧 ==========
// 到價整理每發現一檔「新進入」，就記一筆
export async function logEvents(rows) {
  const date = tpeDate();
  for (const r of rows) await store.add('events', { date, code: r.code, name: r.name ?? null, zone: r.zone, price: r.price });
}

export async function weeklyReview(watchlist) {
  const daysAgo = n => tpeDate(new Date(Date.now() - n * 86400000));
  const events = await store.query('events', [['date', '>=', daysAgo(35)]]);
  // 同一檔同一天只算一次（取最深的那一區）
  const uniq = new Map();
  for (const e of events) { const k = `${e.date}_${e.code}`; if (!uniq.has(k) || (M.ZONE[e.zone]?.rank ?? 0) > (M.ZONE[uniq.get(k).zone]?.rank ?? 0)) uniq.set(k, e); }
  const list = [...uniq.values()];
  const codes = [...new Set(list.map(e => e.code))];
  const items = codes.map(c => watchlist.find(x => x.code === c) ?? { code: c, market: '台股' });
  const { prices } = await quotesFor(items);
  const withRet = list.map(e => {
    const p = prices[e.code]?.price ?? prices[e.code]?.prev;
    return { ...e, date: shortDate(e.date), rawDate: e.date, ret: p && e.price ? p / e.price - 1 : null };
  }).sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  const inRange = (a, b) => withRet.filter(e => e.rawDate >= daysAgo(b) && e.rawDate <= daysAgo(a));
  const groups = [
    { title: '本週到價（到價至今）', rows: inRange(0, 6) },
    { title: '上週到價（約 5 個交易日後）', rows: inRange(7, 13) },
    { title: '四週前到價（約 20 個交易日後）', rows: inRange(25, 34) },
  ];
  const judged = [...groups[1].rows, ...groups[2].rows].filter(e => e.ret != null && !e.zone.startsWith('tp'));
  const win = judged.filter(e => e.ret > 0).length;
  const summary = judged.length
    ? `買點到價後上漲的比例：${win}/${judged.length}（${Math.round(win / judged.length * 100)}%）`
    : '累積的到價紀錄還不夠，幾週後會開始有統計。';
  return M.weeklyMessage({ range: `${shortDate(daysAgo(6))}–${shortDate(daysAgo(0))}`, groups, summary });
}
