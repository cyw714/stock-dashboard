// 檢查「現在的」Google 試算表讀得懂（不檢查價位數字，因為試算表隨時會更新）
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../src/sheet.js';
const all = parseWorkbook(new Uint8Array(readFileSync(process.argv[2])));
const unknown = all.flatMap(x => Object.entries({ ...x.buy, ...x.tp }).filter(([, v]) => v?.unknown).map(([k, v]) => `${x.code} ${k}「${v.raw}」`));
console.log(`試算表目前 ${all.length} 檔：重點觀察 ${all.filter(x => x.group === '重點觀察').length}、其他追蹤 ${all.filter(x => x.group === '其他追蹤').length}`);
if (unknown.length) console.log('⚠️ 看不懂的價位寫法（這幾格不會用來判斷到價）：' + unknown.join('、'));
if (all.length < 5) { console.error('讀到的股票太少，試算表格式可能變了'); process.exit(1); }
