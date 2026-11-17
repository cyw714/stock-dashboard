// store.js — 用 Firestore 記住幾件事
//   runs/{日期}_{時段}     每一次發送的結果（成功、失敗、略過），看門狗靠這個檢查
//   zones/{日期}           今天每一檔已經通知過到哪一區，下一次只列「新進入」的
//   cache/lastAlert        最近一次到價整理的內容，選單「到價整理」按鈕直接拿來回覆
//   cache/sheetSnapshot    上一次晨報時的試算表內容，用來比對「試算表異動」
//   custom/{自動編號}       每個人自己設的價格提醒
//   events/{自動編號}       每一次到價紀錄，給每週回顧用
//
// 在本機測試時（沒有設定 GOOGLE_CLOUD_PROJECT），改用記憶體，不需要連線。

import { Firestore } from '@google-cloud/firestore';

let db = null;
const mem = new Map();
const useMem = !process.env.GOOGLE_CLOUD_PROJECT && !process.env.K_SERVICE;

function fs() {
  if (!db) db = new Firestore({ ignoreUndefinedProperties: true });
  return db;
}

export async function get(path) {
  if (useMem) return mem.get(path) ?? null;
  const snap = await fs().doc(path).get();
  return snap.exists ? snap.data() : null;
}

export async function set(path, data, merge = true) {
  if (useMem) { mem.set(path, merge ? { ...(mem.get(path) ?? {}), ...data } : data); return; }
  await fs().doc(path).set(data, { merge });
}

export async function del(path) {
  if (useMem) { mem.delete(path); return; }
  await fs().doc(path).delete();
}

// 新增一筆（自動編號），回傳編號
export async function add(collection, data) {
  if (useMem) { const id = Math.random().toString(36).slice(2); mem.set(`${collection}/${id}`, data); return id; }
  return (await fs().collection(collection).add(data)).id;
}

// 查詢：where 是 [[欄位, 運算子, 值], ...]
export async function query(collection, where = []) {
  if (useMem) {
    const ops = { '==': (a, b) => a === b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
    return [...mem.entries()].filter(([k]) => k.startsWith(collection + '/'))
      .map(([k, v]) => ({ id: k.slice(collection.length + 1), ...v }))
      .filter(d => where.every(([f, op, val]) => ops[op](d[f], val)));
  }
  let q = fs().collection(collection);
  for (const [f, op, val] of where) q = q.where(f, op, val);
  return (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }));
}
