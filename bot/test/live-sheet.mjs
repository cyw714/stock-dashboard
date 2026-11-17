// 檢查「現在的」Google 試算表讀得懂（不檢查價位數字，因為試算表隨時會更新）
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../src/sheet.js';
const all = parseWorkbook(new Uint8Array(readFileSync(process.argv[2])));
const unknown = all.flatMap(x => Object.entries({ ...x.buy, ...x.tp }).filter(([, v]) => v?.unknown).map(([k, v]) => `${x.code} ${k}「${v.raw}」`));
console.log(`試算表目前 ${all.length} 檔：重點觀察 ${all.filter(x => x.group === '重點觀察').length}、其他追蹤 ${all.filter(x => x.group === '其他追蹤').length}`);
const idx = all.find(x => x.code === 'TAIEX');
console.log('大盤避險列：' + (idx ? JSON.stringify({ group: idx.group, note: idx.note, b1: idx.buy.b1?.raw, b2: idx.buy.b2?.raw, sb: idx.buy.sb?.raw }) : '找不到（A 欄要寫「大盤」）'));
if (unknown.length) console.log('⚠️ 看不懂的價位寫法（這幾格不會用來判斷到價）：' + unknown.join('、'));
if (all.length < 5) { console.error('讀到的股票太少，試算表格式可能變了'); process.exit(1); }
