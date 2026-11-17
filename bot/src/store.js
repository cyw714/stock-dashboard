// store.js — 用 Firestore 記住幾件事
//   runs/{日期}_{時段}     每一次發送的結果（成功、失敗、略過），看門狗靠這個檢查
//   zones/{日期}           今天每一檔已經通知過到哪一區，下一次只列「新進入」的
//   cache/lastAlert        最近一次到價整理的內容，選單「到價整理」按鈕直接拿來回覆
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
