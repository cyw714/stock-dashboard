// messages.js — 把資料排成 LINE 的「Flex 訊息」（就是預覽裡那種卡片）
// 這裡只負責「長什麼樣子」，資料怎麼來在 jobs.js。

export const DASHBOARD_URL = 'https://cyw714.github.io/stock-dashboard/';

const C = {
  head: '#35363A', ink: '#26282B', muted: '#6B6F76', line: '#E6E6E3', soft: '#F3F3F1',
  up: '#B3261E', down: '#1E7A46', link: '#3F5168',
};
export const ZONE = {
  sb: { label: '超級好買點', bg: '#39424E', fg: '#FFFFFF', rank: 3 },
  b2: { label: '買點2', bg: '#5D6B7C', fg: '#FFFFFF', rank: 2 },
  b1: { label: '買點1', bg: '#DCE1E7', fg: '#2C3440', rank: 1 },
  tp1: { label: 'TP1', bg: '#F1E2CC', fg: '#6E4210', rank: 1 },
  tp2: { label: 'TP2', bg: '#F1E2CC', fg: '#6E4210', rank: 2 },
  tp3: { label: 'TP3', bg: '#F1E2CC', fg: '#6E4210', rank: 3 },
};

// ---------- 小工具 ----------
export const fmtPrice = p => p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 100 ? p.toFixed(1) : p.toFixed(2);
export const fmtPct = p => p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(2)}%`;
const pctColor = p => p == null || p === 0 ? C.muted : p > 0 ? C.up : C.down;

const text = (t, o = {}) => ({ type: 'text', text: String(t), size: 'sm', color: C.ink, wrap: true, ...o });
const sep = () => ({ type: 'separator', color: C.line, margin: 'md' });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });
const label = t => text(t, { size: 'xs', color: C.muted, weight: 'bold' });
const chip = z => box('vertical', [text(ZONE[z].label, { size: 'xxs', color: ZONE[z].fg, weight: 'bold', align: 'center' })],
  { backgroundColor: ZONE[z].bg, cornerRadius: '4px', paddingAll: '2px', paddingStart: '6px', paddingEnd: '6px', flex: 0 });
const note = t => box('vertical', [text(t, { size: 'xs', color: C.muted })], { backgroundColor: C.soft, cornerRadius: '8px', paddingAll: '8px', margin: 'md' });

function bubble(title, sub, body, buttons = []) {
  return {
    type: 'bubble', size: 'mega',
    header: box('baseline', [
      text(title, { size: 'md', color: '#FFFFFF', weight: 'bold', flex: 0, wrap: false }),
      text(sub, { size: 'xs', color: '#C9CBCE', align: 'end' }),
    ], { backgroundColor: C.head, paddingAll: '12px' }),
    body: box('vertical', body, { paddingAll: '14px', spacing: 'sm' }),
    ...(buttons.length ? {
      footer: box('horizontal', buttons.map(b => ({
        type: 'button', height: 'sm', style: 'link', color: C.link,
        action: b.uri ? { type: 'uri', label: b.label, uri: b.uri } : { type: 'postback', label: b.label, data: b.data, displayText: b.label },
      })), { paddingAll: '4px' }),
    } : {}),
  };
}
const flex = (altText, contents) => ({ type: 'flex', altText, contents });

// 一列個股：名稱 代號 ……… 價格 / 區間標籤 參考價 ……… 漲跌
function stockRow(s, extra) {
  return box('vertical', [
    box('baseline', [
      text(`${s.name ?? s.code}`, { weight: 'bold', flex: 0, wrap: false }),
      text(` ${s.code}`, { size: 'xs', color: C.muted, flex: 1, wrap: false }),
      text(fmtPrice(s.price), { weight: 'bold', align: 'end', flex: 0 }),
    ]),
    box('horizontal', [
      chip(s.zone),
      text(s.ref ?? '', { size: 'xs', color: C.muted, flex: 1, margin: 'sm', gravity: 'center' }),
      text(fmtPct(s.pct), { size: 'xs', color: pctColor(s.pct), align: 'end', flex: 0, weight: 'bold', gravity: 'center' }),
    ], { margin: 'xs' }),
    ...(extra ? [text(extra, { size: 'xxs', color: C.muted, margin: 'xs' })] : []),
  ], { margin: 'md' });
}

// ---------- 盤前晨報 ----------
export function morningMessage({ dateLabel, intl, counts, notes, alertTimes }) {
  const body = [
    label('國際盤'),
    ...intl.map(r => box('baseline', [
      text(r.label, { flex: 1 }),
      text(fmtPrice(r.price), { flex: 0, align: 'end' }),
      text(fmtPct(r.pct), { flex: 0, align: 'end', color: pctColor(r.pct), weight: 'bold', margin: 'md' }),
    ])),
    sep(),
    label('觀察名單（昨收）'),
    box('horizontal', [
      ['sb', counts.sb, '超級好買點'], ['b1', counts.b, '買點 1–2'], ['tp1', counts.tp, '已到 TP'],
    ].map(([z, n, t]) => box('vertical', [
      text(String(n), { size: 'lg', weight: 'bold', color: ZONE[z].fg, align: 'center' }),
      text(t, { size: 'xxs', color: ZONE[z].fg, align: 'center' }),
    ], { backgroundColor: ZONE[z].bg, cornerRadius: '8px', paddingAll: '6px' })), { spacing: 'sm' }),
  ];
  if (notes.length) body.push(sep(), label('今天注意'), ...notes.slice(0, 5).map(n => text(`• ${n}`, { size: 'xs' })));
  body.push(note(`今天到價整理：${alertTimes.join(' · ')}`));
  return flex(`盤前晨報 ${dateLabel}`, bubble('盤前晨報', `${dateLabel} 08:00`, body, [
    { label: '到價列表', data: 'action=list' }, { label: '開儀表板', uri: DASHBOARD_URL },
  ]));
}

// ---------- 到價整理 ----------
export function alertMessage({ clock, nth, newBuy, newTp, stillCount, nextTime }) {
  const body = [];
  if (newBuy.length) {
    body.push(label(`開盤後新進區間 · ${newBuy.length} 檔`));
    body.push(...newBuy.slice(0, 8).map(s => stockRow(s, s.extra)));
    if (newBuy.length > 8) body.push(text(`還有 ${newBuy.length - 8} 檔，按「到價列表」看全部`, { size: 'xs', color: C.muted, margin: 'sm' }));
  }
  if (newTp.length) {
    if (body.length) body.push(sep());
    body.push(label(`已到目標價 · ${newTp.length} 檔`));
    body.push(...newTp.slice(0, 5).map(s => stockRow(s)));
  }
  if (!newBuy.length && !newTp.length) body.push(text('這次沒有新進入區間或到目標價的股票。', { color: C.muted }));
  body.push(note(`${stillCount ? `另 ${stillCount} 檔已在區間內不重列 · ` : ''}${nextTime ? `下次 ${nextTime}` : '今天的到價整理到此結束'}`));
  return flex(`到價整理 ${clock}：新進 ${newBuy.length} 檔、到目標 ${newTp.length} 檔`,
    bubble('到價整理', `${clock} · 第 ${nth} 次`, body, [{ label: '看完整到價列表', data: 'action=list' }]));
}

// ---------- 到價列表（即時） ----------
export function listMessage({ clock, groups, total }) {
  const body = [];
  for (const g of groups) {
    if (!g.items.length) continue;
    if (body.length) body.push(sep());
    body.push(box('horizontal', [chip(g.zone), text(`${g.items.length} 檔`, { size: 'xs', color: C.muted, margin: 'sm', gravity: 'center' })]));
    body.push(text(g.items.slice(0, 12).map(s => `${s.name ?? s.code} ${fmtPrice(s.price)}`).join(' · ') + (g.items.length > 12 ? ` …等 ${g.items.length} 檔` : ''), { size: 'xs', margin: 'sm' }));
  }
  if (!body.length) body.push(text('目前沒有股票在買點區或目標價。', { color: C.muted }));
  return flex(`到價列表 ${clock}`, bubble('到價列表 · 即時', clock, body, [{ label: `在儀表板看全部 ${total} 檔`, uri: DASHBOARD_URL }]));
}

// ---------- 收盤摘要 ----------
export function closeMessage({ dateLabel, index, gainers, losers, counts }) {
  const row = s => box('baseline', [
    text(`${s.name ?? s.code}`, { flex: 1, wrap: false }),
    text(fmtPrice(s.price), { flex: 0, align: 'end' }),
    text(fmtPct(s.pct), { flex: 0, align: 'end', color: pctColor(s.pct), weight: 'bold', margin: 'md' }),
  ]);
  const body = [
    box('baseline', [text('加權指數', { flex: 1, weight: 'bold' }), text(fmtPrice(index?.price), { flex: 0 }), text(fmtPct(index?.pct), { flex: 0, color: pctColor(index?.pct), weight: 'bold', margin: 'md' })]),
    sep(), label('觀察名單漲最多'), ...gainers.map(row),
    sep(), label('觀察名單跌最多'), ...losers.map(row),
    note(`收盤後：超級好買點 ${counts.sb} 檔 · 買點 1–2 ${counts.b} 檔 · 已到 TP ${counts.tp} 檔`),
  ];
  return flex(`收盤摘要 ${dateLabel}`, bubble('收盤摘要', dateLabel, body, [{ label: '開儀表板', uri: DASHBOARD_URL }]));
}

// ---------- 事件日曆 ----------
export function eventsMessage({ events }) {
  const body = events.length
    ? events.slice(0, 10).map(e => box('baseline', [text(e.date, { size: 'xs', color: C.muted, flex: 0, wrap: false }), text(e.title, { size: 'sm', margin: 'md' })]))
    : [text('近期沒有登記的事件。', { color: C.muted })];
  body.push(note('每月 10 日前公布上個月營收'));
  return flex('事件日曆', bubble('事件日曆', '接下來 30 天', body));
}

export const textMessage = t => ({ type: 'text', text: t });
