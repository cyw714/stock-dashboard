// 本機測試：npm test -- <試算表下載的 .xlsx>
// 不連網路：用假的價格檢查「到價判斷」「只列新進入」「訊息格式」是否正確。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseLevel, parseWorkbook, zoneOf } from '../src/sheet.js';
import { annotate, findNew, countZones } from '../src/jobs.js';
import * as M from '../src/messages.js';
import * as F from '../src/features.js';

// 1. 價位寫法
assert.deepEqual(parseLevel('23X'), { raw: '23X', lo: 230, hi: 239 });
assert.deepEqual(parseLevel('46XX'), { raw: '46XX', lo: 4600, hi: 4699 });
assert.deepEqual(parseLevel('<550'), { raw: '<550', lo: 550, hi: 550 });
assert.deepEqual(parseLevel('6100-5800'), { raw: '6100-5800', lo: 5800, hi: 6100 });
assert.equal(parseLevel('195附近').hi.toFixed(2), '196.95');

// 2. 讀試算表
const all = parseWorkbook(new Uint8Array(readFileSync(process.argv[2])));
const by = c => all.find(x => x.code === c);
assert.equal(by('6147').buy.b1.raw, '174');
assert.equal(by('3081').group, '其他追蹤');
assert.equal(by('CRDO').buy.b1.raw, '177附近');
assert.equal(zoneOf(by('3037'), 740), 'sb');
assert.equal(zoneOf(by('3037'), 860), 'b1');
assert.equal(zoneOf(by('3037'), 1200), 'tp1');

// 3. 到價判斷與「只列新進入」
const items = [by('3037'), by('6147'), by('2327')];
const prices = {
  3037: { price: 860, prev: 900, pct: -0.044, name: '欣興' },   // 昨收在區間外 → 今天進買點1：新
  6147: { price: 150, prev: 155, pct: -0.03, name: '頎邦' },    // 昨收已在超買(158) → 今天還在超買：不算新
  2327: { price: 480, prev: 500, pct: -0.04, name: '國巨' },    // 昨收在買點1(<550) → 今天跌到買點2(490)：更深一區，算新
};
const before = Object.fromEntries(annotate(items, prices, { usePrev: true }).map(r => [r.code, r.zone]));
assert.deepEqual(before, { 3037: null, 6147: 'sb', 2327: 'b1' });
const rows = annotate(items, prices);
const { newBuy, newTp, still } = findNew(rows, before);
assert.deepEqual(newBuy.map(r => r.code).sort(), ['2327', '3037']);
assert.equal(newTp.length, 0);
assert.equal(still, 1);
assert.deepEqual(countZones(rows), { sb: 1, b: 2, tp: 0 });
// 第二次：同樣價格，什麼都不是新的
const again = findNew(rows, Object.fromEntries(rows.map(r => [r.code, r.zone])));
assert.equal(again.newBuy.length + again.newTp.length, 0);

// 4. 訊息格式（LINE 限制：altText ≤ 400 字、一張卡片 ≤ 30KB）
const msgs = [
  M.alertMessage({ clock: '10:30', nth: 1, newBuy, newTp, stillCount: still, nextTime: '11:30' }),
  M.alertMessage({ clock: '13:00', nth: 3, newBuy: [], newTp: [], stillCount: 5, nextTime: null }),
  M.morningMessage({ dateLabel: '11/17（二）', intl: [{ label: '那斯達克', price: 25066, pct: -0.0074 }], counts: { sb: 33, b: 5, tp: 4 }, notes: ['11/18 華邦電 除息 2 元'], alertTimes: ['10:30', '11:30', '13:00'] }),
  M.listMessage({ clock: '09:12', total: 48, groups: [{ zone: 'sb', items: rows }] }),
  M.closeMessage({ dateLabel: '11/17（二）', index: { price: 42787, pct: 0.0018 }, gainers: rows, losers: rows, counts: { sb: 1, b: 2, tp: 0 } }),
  M.eventsMessage({ events: [{ date: '11/18', title: '華邦電 除息 2 元' }] }),
];
for (const m of msgs) {
  assert.ok(m.altText.length <= 400);
  assert.ok(JSON.stringify(m.contents).length < 30000);
  (function walk(o) { if (o && typeof o === 'object') { if (o.type === 'text') assert.ok(o.text.length > 0, '空白文字 LINE 會拒收'); Object.values(o).forEach(walk); } })(m.contents);
}
// 5. 試算表異動
const prevSnap = { 3037: { name: '欣興', group: '重點觀察', b1: '1110', b2: null, sb: '1025', tp1: '1450', tp2: null, tp3: null, tech: 9 }, 3653: { name: '健策', group: '其他追蹤', b1: '6700' } };
const curSnap = { 3037: { name: '欣興', group: '其他追蹤', b1: '870', b2: null, sb: '1025', tp1: '1450', tp2: null, tp3: null, tech: 8.6 }, 2492: { name: '華新科', group: '其他追蹤' } };
const d = F.diffSnapshots(prevSnap, curSnap);
assert.deepEqual(d.map(x => x.kind), ['add', 'remove', 'level', 'group', 'score']);
assert.ok(d[2].text.includes('買點1 1110 → 870'));
msgs.push(M.morningMessage({ dateLabel: '11/17（二）', intl: [], counts: { sb: 1, b: 1, tp: 1 }, notes: [], alertTimes: ['10:30'], diffs: { since: '11/14', items: d } }));
msgs.push(M.diffMessage({ since: '11/14', until: '11/17', items: d }));

// 6. 查股、自訂提醒（用記憶體代替資料庫）
assert.equal(F.findItem(rows, '欣興')?.code, '3037');
assert.equal(F.findItem(rows, '3037')?.code, '3037');
const card = await F.lookup(rows, '3037');
msgs.push(card);
assert.match(await F.addCustom('U1', rows, '3037', '700'), /跌到 700/);
assert.match(await F.listCustom('U1'), /欣興 跌到 700/);
assert.match(await F.cancelCustom('U1', rows, '欣興'), /已取消 3037/);
assert.match(await F.listCustom('U1'), /沒有設定提醒/);

// 7. 每週回顧訊息
msgs.push(M.weeklyMessage({ range: '11/10–11/16', groups: [{ title: '本週到價', rows: [{ date: '11/12', code: '3037', name: '欣興', zone: 'sb', ret: 0.03 }] }, { title: '上週', rows: [] }], summary: '買點到價後上漲的比例：1/1' }));
for (const m of msgs.slice(-4)) {
  assert.ok(m.altText.length <= 400);
  (function walk(o) { if (o && typeof o === 'object') { if (o.type === 'text') assert.ok(o.text.length > 0, '空白文字 LINE 會拒收'); Object.values(o).forEach(walk); } })(m.contents);
}

console.log(`全部 ${all.length} 檔；到價判斷、新進入、訊息格式、試算表異動、查股、自訂提醒都正確`);
console.log('✓ 全部測試通過');
