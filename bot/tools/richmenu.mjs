// 建立新的六格圖文選單
//   node tools/richmenu.mjs test   只換給你自己看（其他朋友還是舊選單）
//   node tools/richmenu.mjs live   換成所有人的預設選單（正式切換時才用）
import { readFileSync } from 'node:fs';

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN, ADMIN = process.env.LINE_ADMIN_USER_ID;
const mode = process.argv[2] ?? 'test';
const DASHBOARD = 'https://cyw714.github.io/stock-dashboard/';

async function api(path, { method = 'POST', body, type = 'application/json', host = 'api.line.me' } = {}) {
  const res = await fetch(`https://${host}/v2/bot${path}`, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': type } : {}) },
    body: type === 'application/json' && body ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} 失敗：${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const W = 2500, H = 1686, cw = Math.floor(W / 3), ch = Math.floor(H / 2);
const cell = (i, action) => ({ bounds: { x: (i % 3) * cw, y: Math.floor(i / 3) * ch, width: cw, height: ch }, action });
const pb = (label, action) => ({ type: 'postback', label, data: `action=${action}`, displayText: label });

const menu = {
  size: { width: W, height: H }, selected: true, name: 'stockie v2', chatBarText: '選單',
  areas: [
    cell(0, pb('今日晨報', 'morning')), cell(1, pb('到價列表', 'list')), cell(2, pb('到價整理', 'alert')),
    cell(3, pb('收盤摘要', 'close')), cell(4, pb('事件日曆', 'events')), cell(5, { type: 'uri', label: '儀表板', uri: DASHBOARD }),
  ],
};

const { richMenuId } = await api('/richmenu', { body: menu });
await api(`/richmenu/${richMenuId}/content`, { host: 'api-data.line.me', type: 'image/png', body: readFileSync(new URL('../assets/richmenu-v2.png', import.meta.url)) });
if (mode === 'live') {
  await api(`/user/all/richmenu/${richMenuId}`);
  console.log(`✓ 新選單已設為所有人的預設：${richMenuId}`);
} else {
  await api(`/user/${ADMIN}/richmenu/${richMenuId}`);
  console.log(`✓ 新選單只套用在你的帳號：${richMenuId}`);
}
