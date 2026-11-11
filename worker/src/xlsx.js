// xlsx.js — 把 Google 試算表「下載成 Excel」的檔案讀成一列一列的文字，並讀出 A 欄的底色
//
// 為什麼要讀 Excel 格式、不讀 CSV：CSV 只有文字，看不到顏色。
// 我們要靠「國內」分頁裡那條灰色分隔列，分出「重點觀察」和「其他追蹤」，所以需要顏色資訊。
// 這樣不用改動試算表本身，擁有者把灰色列上下移動，分組也會自動跟著變。

import { unzipSync, strFromU8 } from 'fflate';

const unesc = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unesc(m[1]) : null;
};

// 欄位字母 → 第幾欄（A=0, B=1, …, AA=26）
const colIndex = ref => {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// 數字轉回試算表上看到的樣子（Excel 會把 52.6 存成 52.600000000000001 之類）
const tidy = v => {
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(v)) return v;
  const n = +v;
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(6));
};

/**
 * 讀取 xlsx 檔
 * @param {Uint8Array} bytes  檔案內容
 * @returns {Object<string, {rows: string[][], fills: (string|null)[]}>}
 *   以分頁名稱為 key；rows 是每列的文字，fills 是每列 A 欄的底色（例如 "FFCCCCCC"，沒有底色是 null）
 */
export function readXlsx(bytes) {
  const files = unzipSync(bytes);
  const read = p => (files[p] ? strFromU8(files[p]) : '');

  // 共用字串表：文字格子存的是這張表的編號
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(''));

  // 樣式表：格子的 s="編號" → cellXfs 第幾個 → fillId → 底色
  const styles = read('xl/styles.xml');
  const fills = [...(styles.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? '').matchAll(/<fill>([\s\S]*?)<\/fill>/g)]
    .map(m => /patternType="solid"/.test(m[1]) ? attr(m[1].match(/<fgColor[^>]*>/)?.[0] ?? '', 'rgb') : null);
  const xfFill = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').matchAll(/<xf\b[^>]*>/g)]
    .map(m => fills[+(attr(m[0], 'fillId') ?? 0)] ?? null);

  // 分頁名稱 → 檔案位置
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
    .map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)]
    .map(m => ({ name: attr(m[0], 'name'), path: 'xl/' + rels[attr(m[0], 'r:id')].replace(/^\/?xl\//, '') }));

  const out = {};
  for (const { name, path } of sheets) {
    const rows = [], rowFill = [];
    for (const rm of read(path).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const r = +attr(rm[1] ?? rm[3], 'r') - 1;
      const cells = [];
      let aFill = null;
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cm[1], body = cm[2] ?? '';
        const ci = colIndex(attr(tag, 'r'));
        const t = attr(tag, 't'), s = attr(tag, 's');
        let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (t === 's') v = shared[+v];
        else if (t === 'inlineStr') v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
        else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
        cells[ci] = v == null ? '' : tidy(unesc(String(v)));
        if (ci === 0 && s != null) aFill = xfFill[+s] ?? null;
      }
      rows[r] = Array.from(cells, c => c ?? '');
      rowFill[r] = aFill;
    }
    out[name] = { rows: Array.from(rows, r => r ?? []), fills: Array.from(rowFill, f => f ?? null) };
  }
  return out;
}

// A 欄是空白、但有塗非白色的底色 → 就是那條分隔列
export function isSeparator(row, fill) {
  return !(row[0] ?? '').trim() && !!fill && !/^(FF)?FFFFFF$/i.test(fill);
}
