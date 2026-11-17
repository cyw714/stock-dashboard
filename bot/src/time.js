// time.js — 台北時間的小工具（Cloud Run 主機用的是 UTC，所以全部自己換算成台北時間）

const TPE_OFFSET = 8 * 60 * 60 * 1000;

// 回傳台北時間的各個欄位
export function tpeNow(d = new Date()) {
  const t = new Date(d.getTime() + TPE_OFFSET);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: t.getUTCDay(),
  };
}

const pad = n => String(n).padStart(2, '0');

// 2026-11-17
export function tpeDate(d = new Date()) {
  const t = tpeNow(d);
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
}

// 11/17（二）
export function tpeLabel(d = new Date()) {
  const t = tpeNow(d);
  return `${t.m}/${t.d}（${'日一二三四五六'[t.wd]}）`;
}

// 09:12
export function tpeClock(d = new Date()) {
  const t = tpeNow(d);
  return `${pad(t.hh)}:${pad(t.mm)}`;
}

// 從午夜起算的分鐘數，用來比較「現在是不是已經過了 10:30」
export function tpeMinutes(d = new Date()) {
  const t = tpeNow(d);
  return t.hh * 60 + t.mm;
}
