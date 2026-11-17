// jobs.js — stockie 的主要工作：晨報、到價整理、看門狗、回覆選單
//
// 時段（台北時間，週一到週五）：
//   morning  08:00  盤前晨報
//   a1030    10:30  到價整理第 1 次
//   a1130    11:30  到價整理第 2 次
//   a1300    13:00  到價整理第 3 次
// 每一次執行結果都寫進 Firestore 的 runs/{日期}_{時段}，看門狗每 5 分鐘檢查一次，
// 發現該發的沒發成功，就自動補發並私訊通知你。

import { loadWatchlist, zoneOf } from './sheet.js';
import { quotesFor, twQuotes, yahooQuotes, txfQuote } from './quotes.js';
import * as line from './line.js';
import * as store from './store.js';
import * as M from './messages.js';
import { tpeDate, tpeLabel, tpeClock, tpeMinutes, tpeNow } from './time.js';
import * as F from './features.js';

export const SLOTS = {
  morning: { at: 8 * 60, label: '08:00 晨報' },
  a1030: { at: 10 * 60 + 30, label: '10:30 到價整理', nth: 1, next: '11:30' },
  a1130: { at: 11 * 60 + 30, label: '11:30 到價整理', nth: 2, next: '13:00' },
  a1300: { at: 13 * 60, label: '13:00 到價整理', nth: 3, next: null },
};
const ALERT_TIMES = ['10:30', '11:30', '13:00'];
const BUY = ['b1', 'b2', 'sb'], TP = ['tp1', 'tp2', 'tp3'];

// ---------- 共用：讀清單、配上價格、判斷區間 ----------
let wlCache = { at: 0, items: null };
export async function watchlist() {
  if (wlCache.items && Date.now() - wlCache.at < 60_000) return wlCache.items;  // 1 分鐘內重複使用，避免一直下載
  const items = await loadWatchlist();
  // 試算表圖片上的價位（annotations.json）：把「見右圖」換成文字
  try {
    const r = await fetch('https://raw.githubusercontent.com/cyw714/stock-dashboard/main/annotations.json');
    const ann = r.ok ? (await r.json()).stocks ?? {} : {};
    for (const x of items) if (ann[x.code] && (!x.note || /見.?圖/.test(x.note))) x.note = ann[x.code].text;
  } catch { /* 沒有也沒關係 */ }
  wlCache = { at: Date.now(), items };
  return wlCache.items;
}

const levelText = (item, z) => {
  const L = { sb: ['超買', item.buy.sb], b2: ['買2', item.buy.b2], b1: ['買1', item.buy.b1], tp1: ['TP1', item.tp.tp1], tp2: ['TP2', item.tp.tp2], tp3: ['TP3', item.tp.tp3] }[z];
  return L && L[1] ? `${L[0]} ${L[1].raw}` : '';
};

// 把清單和價格合在一起；usePrev=true 時用昨收價判斷（晨報、開盤前用）
export function annotate(items, prices, { usePrev = false } = {}) {
  return items.map(x => {
    const q = prices[x.code];
    const price = q ? (usePrev ? q.prev : (q.price ?? q.prev)) : null;
    const zone = x.code === 'TAIEX' ? null : zoneOf(x, price);   // 大盤是避險加碼點，不算到價
    return { ...x, name: x.name ?? q?.name ?? null, price, pct: usePrev ? null : q?.pct ?? null, prev: q?.prev ?? null, zone, ref: zone ? levelText(x, zone) : '' };
  });
}

export function countZones(rows) {
  return {
    sb: rows.filter(r => r.zone === 'sb').length,
    b: rows.filter(r => r.zone === 'b1' || r.zone === 'b2').length,
    tp: rows.filter(r => TP.includes(r.zone)).length,
  };
}

// 比較這次和之前：只挑出「新進入」或「更深一區」的
export function findNew(rows, before) {
  const newBuy = [], newTp = [];
  let still = 0;
  for (const r of rows) {
    if (!r.zone) continue;
    const prev = before[r.code] ?? null;
    const isBuy = BUY.includes(r.zone);
    const rank = M.ZONE[r.zone].rank;
    const prevRank = prev && (BUY.includes(prev) === isBuy) ? M.ZONE[prev].rank : 0;
    if (rank > prevRank) (isBuy ? newBuy : newTp).push(r);
    else still++;
  }
  const byDepth = (a, b) => M.ZONE[b.zone].rank - M.ZONE[a.zone].rank || (a.pct ?? 0) - (b.pct ?? 0);
  return { newBuy: newBuy.sort(byDepth), newTp: newTp.sort(byDepth), still };
}

// 每一檔今天到過最深的區間（避免價格來回跳動時重複通知）
function deeper(a, b) {
  if (!a) return b; if (!b) return a;
  if (BUY.includes(a) !== BUY.includes(b)) return b;
  return M.ZONE[b].rank > M.ZONE[a].rank ? b : a;
}

// ---------- 今天有沒有開盤 ----------
let holidayCache = { year: null, days: new Set() };
export async function isHoliday(date = tpeDate()) {
  const { wd } = tpeNow();
  if (wd === 0 || wd === 6) return true;
  const year = date.slice(0, 4);
  if (holidayCache.year !== year) {
    try {
      const res = await fetch('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule');
      const list = await res.json();
      const days = new Set();
      for (const h of list) {
        const name = `${h.Name ?? ''}${h.Description ?? ''}`;
        if (/交易日|開始交易|最後交易/.test(name) && !/無交易|休市/.test(name)) continue;  // 「最後交易日」那種是有開盤的
        const raw = String(h.Date ?? '').replace(/\D/g, '');  // 民國年：1151225
        if (raw.length >= 7) days.add(`${+raw.slice(0, raw.length - 4) + 1911}-${raw.slice(-4, -2)}-${raw.slice(-2)}`);
      }
      holidayCache = { year, days };
    } catch (e) {
      console.warn('讀不到休市日，當作有開盤：', e.message);
      return false;
    }
  }
  return holidayCache.days.has(date);
}

// ---------- 紀錄 ----------
async function record(slot, status, detail = {}) {
  const id = `runs/${tpeDate()}_${slot}`;
  const prev = (await store.get(id)) ?? {};
  await store.set(id, { slot, status, at: new Date().toISOString(), attempts: (prev.attempts ?? 0) + 1, ...detail });
}

// 額度守門：群發前確認額度夠；到價整理會保留本月剩下晨報需要的額度
async function quotaOk(kind) {
  if (line.isTestMode()) return true;
  const left = await line.quotaLeft();
  if (left == null || left === Infinity) return true;
  const friends = (await line.friendCount()) ?? 6;
  if (kind === 'morning') return left >= friends;
  const t = tpeNow();
  const daysInMonth = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  let weekdaysLeft = 0;
  for (let d = t.d + 1; d <= daysInMonth; d++) { const wd = new Date(Date.UTC(t.y, t.m - 1, d)).getUTCDay(); if (wd && wd !== 6) weekdaysLeft++; }
  return left - friends >= friends * weekdaysLeft;
}

async function infoJson() {
  try {
    const r = await fetch('https://raw.githubusercontent.com/cyw714/stock-dashboard/main/info.json');
    return await r.json();
  } catch { return {}; }
}

// ---------- 大盤避險：試算表的加碼點與距離（G 分數、五策略請按按鈕到避險儀表板看） ----------
async function hedgeInfo(items, index) {
  const x = items.find(i => i.code === 'TAIEX');
  const idx = index?.price ?? index?.prev;
  if (!idx) return null;
  if (!x) return { index: idx, levels: [], g: null, signals: null };
  const alloc = String(x.note ?? '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  const levels = [x.buy.b1, x.buy.b2, x.buy.sb].map((L, i) => L?.lo ? { raw: L.raw, lo: L.lo, alloc: alloc[i] } : null).filter(Boolean)
    .sort((a, b) => a.lo - b.lo)
    .map(l => ({ ...l, dist: `${l.lo / idx - 1 > 0 ? '+' : ''}${((l.lo / idx - 1) * 100).toFixed(1)}%` }));
  return { index: idx, levels, g: null, signals: null };  // G 分數、五策略請到避險儀表板看
}

// ---------- 盤前晨報 ----------
export async function buildMorning({ save = false } = {}) {
  const items = await watchlist();
  const tw = items.filter(x => x.market === '台股').map(x => x.code);
  const [t, intl, txf, info] = await Promise.all([twQuotes(tw), yahooQuotes(['^IXIC', '^SOX']), txfQuote(), infoJson()]);
  const prices = { ...t.stocks, ...(t.index ? { TAIEX: t.index } : {}) };
  const rows = annotate(items.filter(x => x.market === '台股' || x.code === 'TAIEX'), prices, { usePrev: true });

  const today = tpeDate(), yesterday = tpeDate(new Date(Date.now() - 86400000));
  const week = tpeDate(new Date(Date.now() + 7 * 86400000));
  const nameOf = c => rows.find(r => r.code === c)?.name ?? c;
  const notes = [
    ...(info.exdiv ?? []).filter(e => e.date >= today && e.date <= week)
      .map(e => `${e.date.slice(5).replace('-', '/')} ${e.name ?? nameOf(e.code)} 除${e.kind ?? '息'}${e.cash ? ` ${e.cash} 元` : ''}`),
    ...(info.news ?? []).filter(n => n.date >= yesterday).slice(0, 3).map(n => `${n.name}：${n.title}`),
  ];
  const names = Object.fromEntries(Object.entries(t.stocks).map(([c, q]) => [c, q.name]));
  const diffs = await F.sheetDiff(items, names, { save }).catch(e => { console.warn('試算表異動比對失敗：', e.message); return null; });
  return M.morningMessage({
    diffs,
    hedge: await hedgeInfo(items, t.index),
    dateLabel: tpeLabel(),
    intl: [
      { label: '那斯達克', ...intl['^IXIC'] },
      { label: '費城半導體', ...intl['^SOX'] },
      ...(txf ? [{ label: txf.night ? '台指期夜盤' : '台指期', ...txf }] : []),
    ],
    counts: countZones(rows),
    notes,
    alertTimes: ALERT_TIMES,
  });
}

export async function runMorning({ force = false } = {}) {
  if (!force && await isHoliday()) { await record('morning', 'skipped', { reason: '休市' }); return { skipped: '休市' }; }
  if (!(await quotaOk('morning'))) throw new Error('LINE 額度不足');
  const msg = await buildMorning({ save: !force });
  await line.send(msg);
  if (!force) await record('morning', 'ok');
  return { ok: true };
}

// ---------- 到價整理 ----------
export async function runAlert(slot, { force = false } = {}) {
  const S = SLOTS[slot];
  if (!S?.nth) throw new Error(`不認得的時段 ${slot}`);
  const items = await watchlist();
  const { prices, tradeDate } = await quotesFor(items, { foreign: false });
  const today = tpeDate();
  if (!force && tradeDate && tradeDate !== today.replace(/-/g, '')) { await record(slot, 'skipped', { reason: '今天沒有開盤' }); return { skipped: '休市' }; }

  const rows = annotate(items.filter(x => x.market !== '美股'), prices).filter(r => r.price != null);
  // 之前的狀態：今天第一次就用昨收價算，之後用今天到過最深的區間
  const saved = force ? null : await store.get(`zones/${today}`);
  const before = saved?.zones ?? Object.fromEntries(annotate(items, prices, { usePrev: true }).map(r => [r.code, r.zone]));
  const { newBuy, newTp, still } = findNew(rows, before);

  const zones = { ...before };
  for (const r of rows) zones[r.code] = deeper(zones[r.code] ?? null, r.zone);
  const msg = M.alertMessage({ clock: tpeClock(), nth: S.nth, newBuy, newTp, stillCount: still, nextTime: S.next });

  const empty = !newBuy.length && !newTp.length;
  const skipEmpty = process.env.ALERT_SKIP_EMPTY === 'true';
  if (!(empty && skipEmpty)) {
    if (!(await quotaOk('alert'))) {
      await record(slot, 'skipped', { reason: 'LINE 額度只夠留給晨報' });
      await store.set(`zones/${today}`, { zones });
      return { skipped: '額度' };
    }
    await line.send(msg);
  }
  if (force) return { ok: true, test: true, newBuy: newBuy.length, newTp: newTp.length };  // 測試：不寫入紀錄
  await F.logEvents([...newBuy, ...newTp]).catch(e => console.warn('到價紀錄失敗：', e.message));
  await store.set(`zones/${today}`, { zones });
  await store.set('cache/lastAlert', { message: msg, at: new Date().toISOString(), slot });
  await record(slot, 'ok', { newBuy: newBuy.length, newTp: newTp.length, sent: !(empty && skipEmpty) });
  return { ok: true, newBuy: newBuy.length, newTp: newTp.length };
}

// 現在最接近哪一個到價時段（鬧鐘只會呼叫 /cron/alert，由這裡判斷是第幾次）
export function currentAlertSlot(min = tpeMinutes()) {
  const hit = Object.entries(SLOTS).filter(([, S]) => S.nth).find(([, S]) => min >= S.at - 10 && min <= S.at + 60);
  return hit?.[0] ?? null;
}

export async function runSlot(slot, { force = false } = {}) {
  if (!force) {
    const r = await store.get(`runs/${tpeDate()}_${slot}`);
    if (r?.status === 'ok' || r?.status === 'skipped') return { already: r.status };  // 已經發過：避免重試時重複發送
  }
  try {
    return slot === 'morning' ? await runMorning({ force }) : await runAlert(slot, { force });
  } catch (e) {
    console.error(`${slot} 失敗：`, e);
    if (!force) await record(slot, 'error', { error: String(e.message ?? e) }).catch(() => {});
    throw e;
  }
}

// ---------- 看門狗 ----------
// 每 5 分鐘被叫一次：檢查「時間已經過了 5 分鐘以上、但還沒成功」的時段，補發並通知你
export async function watchdog() {
  const now = tpeMinutes(), today = tpeDate();
  const report = [];
  for (const [slot, S] of Object.entries(SLOTS)) {
    if (now < S.at + 5 || now > S.at + 90) continue;
    const r = await store.get(`runs/${today}_${slot}`);
    if (r && (r.status === 'ok' || r.status === 'skipped')) continue;
    if (r?.attempts >= 4) {
      if (!r.gaveUp) {
        await store.set(`runs/${today}_${slot}`, { gaveUp: true });
        await line.pushAdmin(`⚠️ stockie：${S.label} 補發了 3 次都失敗，請找 Claude 看一下。\n原因：${r.error ?? '不明'}`).catch(() => {});
      }
      continue;
    }
    try {
      const res = await runSlot(slot);
      if (!res.skipped) await line.pushAdmin(`🛠 stockie：${S.label} 沒有準時發出${r?.error ? `（${r.error}）` : ''}，已經自動補發成功。`).catch(() => {});
      report.push({ slot, retried: true, ok: true });
    } catch (e) {
      report.push({ slot, retried: true, ok: false, error: e.message });
    }
  }
  try {
    const fired = await F.checkCustom(await watchlist());
    if (fired.length) report.push({ custom: fired });
  } catch (e) { console.warn('自訂提醒檢查失敗：', e.message); }
  return report;
}

// ---------- 每週回顧（週日 20:00，只私訊你；其他人可以打「回顧」查看） ----------
export async function runWeekly({ force = false } = {}) {
  const id = `runs/${tpeDate()}_weekly`;
  if (!force && (await store.get(id))?.status === 'ok') return { already: 'ok' };
  const msg = await F.weeklyReview(await watchlist());
  await line.pushTo(process.env.LINE_ADMIN_USER_ID, msg);
  if (!force) await store.set(id, { status: 'ok', at: new Date().toISOString() });
  return { ok: true };
}

// ---------- 選單按鈕的回覆（回覆不算 LINE 訊息則數） ----------
export async function buildList() {
  const items = await watchlist();
  const { prices } = await quotesFor(items);
  const rows = annotate(items, prices);
  const by = z => rows.filter(r => r.zone === z).sort((a, b) => (b.scores?.tech ?? 0) - (a.scores?.tech ?? 0));
  return M.listMessage({
    clock: tpeClock(),
    total: rows.length,
    groups: [
      { zone: 'tp1', items: rows.filter(r => TP.includes(r.zone)) },
      { zone: 'b1', items: [...by('b2'), ...by('b1')] },
      { zone: 'sb', items: by('sb') },
    ],
  });
}

export async function buildClose() {
  if (tpeMinutes() < 13 * 60 + 35 && tpeMinutes() > 8 * 60) return M.textMessage('收盤摘要在 13:35 之後提供喔。');
  const items = await watchlist();
  const tw = items.filter(x => x.market === '台股');
  const t = await twQuotes(tw.map(x => x.code));
  const rows = annotate(tw, t.stocks).filter(r => r.pct != null);
  const sorted = [...rows].sort((a, b) => b.pct - a.pct);
  return M.closeMessage({ dateLabel: tpeLabel(), index: t.index, gainers: sorted.slice(0, 3), losers: sorted.slice(-3).reverse(), counts: countZones(rows) });
}

export async function buildEvents() {
  const info = await infoJson();
  const today = tpeDate(), until = tpeDate(new Date(Date.now() + 30 * 86400000));
  const events = (info.exdiv ?? []).filter(e => e.date >= today && e.date <= until)
    .map(e => ({ date: e.date.slice(5).replace('-', '/'), title: `${e.name} 除${e.kind ?? '息'}${e.cash ? ` ${e.cash} 元` : ''}` }));
  return M.eventsMessage({ events });
}

const ACTIONS = {
  morning: buildMorning,
  list: buildList,
  alert: async () => (await store.get('cache/lastAlert'))?.message ?? M.textMessage('今天還沒有到價整理，第一次是 10:30。'),
  close: buildClose,
  events: buildEvents,
  diff: F.lastDiff,
  review: async () => F.weeklyReview(await watchlist()),
};
const KEYWORDS = [[/晨報/, 'morning'], [/到價列表|列表/, 'list'], [/到價整理|整理/, 'alert'], [/收盤/, 'close'], [/事件|日曆|除息/, 'events'], [/異動/, 'diff'], [/回顧/, 'review']];
const HELP = '可以這樣用：\n• 打代號或名稱（例如 3037、欣興）→ 查股小卡\n• 提醒 3037 700 → 碰到 700 通知你\n• 我的提醒／取消提醒 3037\n• 晨報、到價列表、到價整理、收盤、事件、異動、回顧';

// 打字的指令：提醒、查股
async function textCommand(ev) {
  const msg = ev.message.text.trim(), uid = ev.source?.userId;
  let m;
  if ((m = msg.match(/^提醒\s*(\S+)\s+([\d.,]+)$/))) return M.textMessage(await F.addCustom(uid, await watchlist(), m[1], m[2]));
  if ((m = msg.match(/^提醒\s*(\S+)$/))) {
    const hit = F.findItem(await watchlist(), m[1]);
    return M.textMessage(`要設定在什麼價格呢？請加上價格，例如：\n提醒 ${hit?.code ?? m[1]} ${hit?.buy?.b1?.raw?.replace(/[^\d.]/g, '') || '100'}\n\n（股票代號和價格中間要空一格）`);
  }
  if ((m = msg.match(/^取消提醒\s*(\S+)$/))) return M.textMessage(await F.cancelCustom(uid, await watchlist(), m[1]));
  if (/^(我的提醒|提醒清單|提醒列表)$/.test(msg)) return M.textMessage(await F.listCustom(uid));
  if (/^(說明|help|指令|\?)$/i.test(msg)) return M.textMessage(HELP);
  const kw = KEYWORDS.find(([re]) => re.test(msg))?.[1];
  if (kw) return ACTIONS[kw]();
  // 查股：代號或名稱
  const items = await watchlist();
  const hit = F.findItem(items, msg);
  if (hit || /^\d{4,6}[A-Z]?$/.test(msg)) {
    const rows = hit ? annotate([hit], (await quotesFor([hit])).prices) : [];
    return F.lookup(rows, msg);
  }
  return M.textMessage(`看不懂「${msg.slice(0, 20)}」😅\n\n${HELP}`);
}

export async function handleEvent(ev) {
  let action = null;
  if (ev.type === 'postback') action = new URLSearchParams(ev.postback.data).get('action');
  else if (ev.type === 'message' && ev.message.type === 'text') {
    if (!ev.replyToken) return;
    try {
      const out = await textCommand(ev);
      if (out) await line.reply(ev.replyToken, out);
    } catch (e) {
      console.error('文字指令失敗：', e);
      await line.reply(ev.replyToken, M.textMessage('暫時查不到，請稍後再試一次。')).catch(() => {});
    }
    return;
  }
  else if (ev.type === 'follow') {
    return line.reply(ev.replyToken, M.textMessage('歡迎加入 stockie！每個交易日 08:00 發盤前晨報，10:30、11:30、13:00 整理到價的股票。下方選單隨時可以查即時到價，也可以直接打股票代號查詢、打「提醒 3037 700」設定價格提醒。'));
  }
  if (!action || !ACTIONS[action] || !ev.replyToken) return;
  try {
    await line.reply(ev.replyToken, await ACTIONS[action]());
  } catch (e) {
    console.error('回覆失敗：', e);
    await line.reply(ev.replyToken, M.textMessage('資料暫時抓不到，請稍後再按一次。')).catch(() => {});
  }
}
