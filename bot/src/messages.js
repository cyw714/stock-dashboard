// messages.js — 把資料排成 LINE 的「Flex 訊息」（就是預覽裡那種卡片）
// 這裡只負責「長什麼樣子」，資料怎麼來在 jobs.js。

export const DASHBOARD_URL = 'https://cyw714.github.io/stock-dashboard/';
export const HEDGE_URL = 'https://hdg-80yyy10t.pages.dev/';

// A 版：全炭灰，和儀表板炭灰版同一套顏色（紅漲綠跌）
const C = {
  head: '#2A2B2E', body: '#35363A', ink: '#EDEDEB', muted: '#A8AAAE', line: '#4B4C51', soft: '#3E3F43',
  up: '#E39EA3', down: '#8EC3A6', link: '#B7C2D6',
};
export const ZONE = {
  sb: { label: '超級好買點', bg: '#8EC3A6', fg: '#1F2A24', rank: 3 },
  b2: { label: '買點2', bg: '#354740', fg: '#8EC3A6', rank: 2 },
  b1: { label: '買點1', bg: '#354740', fg: '#8EC3A6', rank: 1 },
  bx: { label: '圖上支撐區', bg: '#354740', fg: '#8EC3A6', rank: 0.5 },
  tp1: { label: 'TP1', bg: '#4A3A3C', fg: '#E39EA3', rank: 1 },
  tp2: { label: 'TP2', bg: '#4A3A3C', fg: '#E39EA3', rank: 2 },
  tp3: { label: 'TP3', bg: '#4A3A3C', fg: '#E39EA3', rank: 3 },
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
      text(sub, { size: 'xs', color: C.muted, align: 'end' }),
    ], { backgroundColor: C.head, paddingAll: '12px' }),
    body: box('vertical', body, { paddingAll: '14px', spacing: 'sm', backgroundColor: C.body }),
    ...(buttons.length ? {
      footer: box('horizontal', buttons.map(b => ({
        type: 'button', height: 'sm', style: 'link', color: C.link,
        action: b.uri ? { type: 'uri', label: b.label, uri: b.uri } : { type: 'postback', label: b.label, data: b.data, displayText: b.label },
      })), { paddingAll: '4px', backgroundColor: C.body, borderColor: C.line, borderWidth: 'light' }),
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
export function morningMessage({ dateLabel, intl, counts, notes, alertTimes, diffs = null, hedge = null }) {
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
  if (hedge) {
    body.push(sep(), label(`大盤避險（加權 ${fmtPrice(hedge.index)}）`));
    if (!hedge.levels.length) body.push(text('試算表目前沒有填避險加碼點', { size: 'xs', color: C.muted }));
    if (hedge.g != null || hedge.signals) {
      body.push(box('horizontal', [
        ...(hedge.g != null ? [box('vertical', [
          text('多空分數 G', { size: 'xxs', color: hedge.g < 0 ? C.up : C.down }),
          text(`${hedge.g > 0 ? '+' : ''}${hedge.g.toFixed(1)} ${hedge.g < 0 ? '偏空' : '偏多'}`, { size: 'md', weight: 'bold', color: hedge.g < 0 ? C.up : C.down }),
        ], { backgroundColor: hedge.g < 0 ? '#4A3A3C' : '#354740', cornerRadius: '8px', paddingAll: '7px' })] : []),
        ...(hedge.signals ? [box('vertical', [
          text('五策略訊號', { size: 'xxs', color: C.muted }),
          text(`${hedge.signals.filter(Boolean).length}／${hedge.signals.length} 建議持有空單`, { size: 'xs', weight: 'bold' }),
        ], { backgroundColor: C.soft, cornerRadius: '8px', paddingAll: '7px' })] : []),
      ], { spacing: 'sm' }));
    }
    body.push(...hedge.levels.map(l => box('baseline', [
      text(l.raw, { size: 'xs', flex: 4 }),
      text(l.alloc ?? '', { size: 'xs', color: C.muted, flex: 2, align: 'end' }),
      text(l.dist, { size: 'xs', weight: 'bold', flex: 2, align: 'end' }),
    ])));
  }
  if (notes.length) body.push(sep(), label('今天注意'), ...notes.slice(0, 5).map(n => text(`• ${n}`, { size: 'xs' })));
  if (diffs?.items.length) {
    body.push(sep(), label(`試算表異動（${diffs.since} → 今天）`), ...diffs.items.slice(0, 5).map(diffRow));
    if (diffs.items.length > 5) body.push(text(`另有 ${diffs.items.length - 5} 項變動 · 按「試算表異動」看全部`, { size: 'xxs', color: C.muted }));
  }
  body.push(note(`今天到價整理：${alertTimes.join(' · ')}`));
  return flex(`盤前晨報 ${dateLabel}`, bubble('盤前晨報', `${dateLabel} 08:00`, body, [
    { label: '到價列表', data: 'action=list' },
    ...(diffs?.items.length ? [{ label: '試算表異動', data: 'action=diff' }] : []),
    { label: '避險儀表板', uri: HEDGE_URL },
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

// ---------- 試算表異動 ----------
const DIFF_TAG = { add: ['新增', '#8EC3A6', '#1F2A24'], remove: ['移除', '#E39EA3', '#3A2224'], level: ['價位', '#3E3F43', '#EDEDEB'], group: ['分組', '#3E3F43', '#EDEDEB'], score: ['評分', '#3E3F43', '#EDEDEB'] };
function diffRow(d) {
  const [t, bg, fg] = DIFF_TAG[d.kind];
  return box('horizontal', [
    box('vertical', [text(t, { size: 'xxs', color: fg, weight: 'bold', align: 'center' })], { backgroundColor: bg, cornerRadius: '4px', paddingAll: '2px', width: '36px', flex: 0 }),
    text(d.text, { size: 'xs', margin: 'sm', flex: 1 }),
  ], { margin: 'xs' });
}
export function diffMessage(diffs) {
  const body = diffs?.items.length ? diffs.items.slice(0, 40).map(diffRow) : [text('最近沒有異動。', { color: C.muted })];
  return flex('試算表異動', bubble('試算表異動', diffs?.since ? `${diffs.since} → ${diffs.until}` : '', body));
}

// ---------- 查股小卡 ----------
export function stockCard(s) {
  const body = [
    box('baseline', [
      text(s.name ?? s.code, { size: 'lg', weight: 'bold', flex: 0, wrap: false }),
      text(` ${s.code} · ${s.market}`, { size: 'xs', color: C.muted, flex: 1, wrap: false }),
    ]),
    box('baseline', [
      text(fmtPrice(s.price), { size: 'xl', weight: 'bold', flex: 0 }),
      text(s.stale ? `　${s.stale}` : `　${fmtPct(s.pct)}`, { size: 'sm', color: s.stale ? C.muted : pctColor(s.pct), weight: 'bold' }),
    ]),
  ];
  if (s.zone) body.push(box('horizontal', [chip(s.zone), text(s.ref ?? '', { size: 'xs', color: C.muted, margin: 'sm', gravity: 'center' })], { margin: 'sm' }));
  else if (s.inList) body.push(text('目前不在買點區或目標價', { size: 'xs', color: C.muted, margin: 'sm' }));
  body.push(sep());
  const kv = (k, v) => box('baseline', [text(k, { size: 'xs', color: C.muted, flex: 3 }), text(v, { size: 'sm', align: 'end', flex: 4, weight: 'bold' })]);
  for (const [k, v] of s.rows) body.push(kv(k, v));
  if (s.note) body.push(note(s.note));
  return flex(`${s.name ?? s.code} ${fmtPrice(s.price)}`, bubble(s.name ?? s.code, '查股', body, [{ label: '開儀表板', uri: DASHBOARD_URL }]));
}

// ---------- 每週回顧 ----------
export function weeklyMessage({ range, groups, summary }) {
  const body = [];
  for (const g of groups) {
    if (body.length) body.push(sep());
    body.push(label(`${g.title} · ${g.rows.length} 筆`));
    if (!g.rows.length) { body.push(text('沒有紀錄', { size: 'xs', color: C.muted })); continue; }
    body.push(...g.rows.slice(0, 8).map(r => box('baseline', [
      text(`${r.date} ${r.name ?? r.code}`, { size: 'xs', flex: 5, wrap: false }),
      text(ZONE[r.zone]?.label ?? r.zone, { size: 'xxs', color: C.muted, flex: 3 }),
      text(fmtPct(r.ret), { size: 'xs', align: 'end', flex: 2, color: pctColor(r.ret), weight: 'bold' }),
    ])));
    if (g.rows.length > 8) body.push(text(`…還有 ${g.rows.length - 8} 筆`, { size: 'xxs', color: C.muted }));
  }
  if (summary) body.push(note(summary));
  return flex(`每週回顧 ${range}`, bubble('每週回顧', range, body, [{ label: '開儀表板', uri: DASHBOARD_URL }]));
}
