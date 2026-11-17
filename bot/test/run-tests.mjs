// 本機測試：npm test -- <試算表下載的 .xlsx>
// 不連網路：用假的價格檢查「到價判斷」「只列新進入」「訊息格式」是否正確。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseLevel, parseWorkbook, zoneOf } from '../src/sheet.js';
import { annotate, findNew, countZones } from '../src/jobs.js';
import * as M from '../src/messages.js';

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
console.log(`全部 ${all.length} 檔；到價判斷、新進入、訊息格式都正確`);
console.log('✓ 全部測試通過');
