// server.js — stockie 的入口：收到網址請求後，交給對應的工作
//
//   POST /cron/morning、/cron/alert（自動判斷是 10:30／11:30／13:00 哪一次）   鬧鐘叫醒發送（要帶 CRON_SECRET）
//        加上 ?force=1 是手動測試：不管休市、不管今天發過沒
//   POST /cron/watchdog                                        看門狗（要帶 CRON_SECRET）
//   POST /line/webhook                                         LINE 選單按鈕（用 Channel secret 驗證）
//   GET  /api/watchlist                                        給網站讀的即時清單＋價格
//   GET  /healthz                                              健康檢查

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import * as jobs from './jobs.js';
import { verifySignature } from './line.js';
import { quotesFor } from './quotes.js';

const PORT = process.env.PORT || 8080;

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

function json(res, code, data, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(data));
}

function cronAuthorized(req) {
  const got = Buffer.from(String(req.headers['x-cron-secret'] ?? ''));
  const want = Buffer.from(process.env.CRON_SECRET ?? '');
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/healthz') return json(res, 200, { ok: true });

    if (path.startsWith('/cron/') && req.method === 'POST') {
      if (!cronAuthorized(req)) return json(res, 403, { error: 'forbidden' });
      let slot = path.slice('/cron/'.length);
      const force = url.searchParams.get('force') === '1';   // 手動測試：不管休市、不管是否發過
      if (slot === 'watchdog') return json(res, 200, { report: await jobs.watchdog() });
      if (slot === 'alert') slot = force ? (jobs.currentAlertSlot() ?? 'a1030') : jobs.currentAlertSlot();
      if (!slot) return json(res, 200, { skipped: '現在不是到價整理的時間' });
      if (!jobs.SLOTS[slot]) return json(res, 404, { error: `沒有 ${slot} 這個時段` });
      return json(res, 200, await jobs.runSlot(slot, { force }));
    }

    if (path === '/line/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      if (!verifySignature(raw, req.headers['x-line-signature'])) return json(res, 403, { error: 'bad signature' });
      const body = JSON.parse(raw.toString('utf8') || '{}');
      await Promise.all((body.events ?? []).map(ev => jobs.handleEvent(ev)));
      return json(res, 200, { ok: true });
    }

    if (path === '/api/watchlist' && req.method === 'GET') {
      const items = await jobs.watchlist();
      const { prices } = await quotesFor(items);
      return json(res, 200, { updated: new Date().toISOString(), items: jobs.annotate(items, prices) },
        { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(path, e);
    json(res, 500, { error: String(e.message ?? e) });
  }
});

server.listen(PORT, () => console.log(`stockie 啟動，port ${PORT}`));
