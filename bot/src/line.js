// line.js — 跟 LINE 溝通的部分
//   發送對象由環境變數 TEST_MODE 決定：
//     TEST_MODE=true  → 只私訊你（LINE_ADMIN_USER_ID），測試期間用
//     TEST_MODE=false → 群發給 stockie 所有好友（broadcast）
//   「回覆」（使用者按選單後的回應）不算 LINE 的訊息則數，免費。

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.line.me/v2/bot';
const token = () => process.env.LINE_CHANNEL_ACCESS_TOKEN;
export const isTestMode = () => (process.env.TEST_MODE ?? 'true') !== 'false';

async function call(path, body, method = 'POST') {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LINE ${path} 失敗：HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// 發給大家（測試模式只發給你）
export async function send(messages) {
  const msgs = Array.isArray(messages) ? messages : [messages];
  if (isTestMode()) return call('/message/push', { to: process.env.LINE_ADMIN_USER_ID, messages: msgs });
  return call('/message/broadcast', { messages: msgs });
}

// 只私訊你（看門狗警報用）
export async function pushAdmin(text) {
  return call('/message/push', { to: process.env.LINE_ADMIN_USER_ID, messages: [{ type: 'text', text }] });
}

// 回覆按選單的人
export async function reply(replyToken, messages) {
  return call('/message/reply', { replyToken, messages: Array.isArray(messages) ? messages : [messages] });
}

// 這個月還剩幾則可以用（額度守門用）；查不到就回傳 null
export async function quotaLeft() {
  try {
    const [q, used] = await Promise.all([call('/message/quota', null, 'GET'), call('/message/quota/consumption', null, 'GET')]);
    if (q.type !== 'limited') return Infinity;
    return q.value - used.totalUsage;
  } catch (e) {
    console.warn('查詢額度失敗：', e.message);
    return null;
  }
}

// 好友人數（估算群發會用掉幾則）
export async function friendCount() {
  try {
    const d = new Date(Date.now() - 2 * 86400000);  // LINE 的統計有一兩天延遲
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const r = await call(`/insight/followers?date=${ymd}`, null, 'GET');
    return r.targetedReaches ?? r.followers ?? null;
  } catch {
    return null;
  }
}

// 確認 webhook 真的是 LINE 送來的（用 Channel secret 驗證簽章）
export function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = createHmac('sha256', process.env.LINE_CHANNEL_SECRET ?? '').update(rawBody).digest();
  const got = Buffer.from(signature, 'base64');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
