// 用試算表下載下來的 Excel 檔測試：npm test -- <檔案.xlsx>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseLevel, parseWorkbook, zoneOf } from '../src/sheet.js';

// 價位寫法
assert.deepEqual(parseLevel('23X'), { raw: '23X', lo: 230, hi: 239 });
assert.deepEqual(parseLevel('46XX'), { raw: '46XX', lo: 4600, hi: 4699 });
assert.deepEqual(parseLevel('<550'), { raw: '<550', lo: 550, hi: 550 });
assert.deepEqual(parseLevel('6100-5800'), { raw: '6100-5800', lo: 5800, hi: 6100 });
assert.deepEqual(parseLevel('215~217'), { raw: '215~217', lo: 215, hi: 217 });
assert.equal(parseLevel('195附近').hi.toFixed(2), '196.95');
assert.equal(parseLevel(''), null);

const all = parseWorkbook(new Uint8Array(readFileSync(process.argv[2])));
const by = c => all.find(x => x.code === c);
assert.equal(by('6147').buy.b1.raw, '174');                 // 重複的 6147：用上面那列
assert.equal(by('6147').group, '重點觀察');
assert.equal(by('3081').group, '其他追蹤');                  // 灰色分隔列以下
assert.equal(by('CRDO').buy.b1.raw, '177附近');             // CRDO：用國外分頁
assert.equal(by('6723').market, '日股');                    // 瑞薩：只在國內分頁，也要保留
assert.equal(by('6190').buy.sb.raw, '52.6');
assert.equal(by('TAIEX').note, '25%,25%,50%');
assert.equal(all.filter(x => x.code === '3533').length, 1);
assert.equal(zoneOf(by('3037'), 740), 'sb');
assert.equal(zoneOf(by('3037'), 860), 'b1');
assert.equal(zoneOf(by('3037'), 1200), 'tp1');

console.log(`全部 ${all.length} 檔`);
for (const g of ['重點觀察', '其他追蹤'])
  console.log(`${g}：` + all.filter(x => x.group === g).map(x => x.code + (x.name ? `(${x.name})` : '')).join('、'));
const unk = all.flatMap(x => Object.entries({ ...x.buy, ...x.tp }).filter(([, v]) => v?.unknown).map(([k, v]) => `${x.code} ${k}「${v.raw}」`));
console.log('看不懂的價位寫法：', unk.length ? unk.join('、') : '沒有');
console.log('✓ 全部測試通過');
