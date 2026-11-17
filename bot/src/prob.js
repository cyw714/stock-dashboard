// prob.js — 到價機率（和網站用同一條公式）
// 股價每天平均走 mu（坡度）、晃動 sigma，在 T 個交易日內「碰到」B 的機率

const erf = x => {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
};
const N = x => 0.5 * (1 + erf(x / Math.SQRT2));

export function hitP(S0, B, mu, sig, T) {
  if (!S0 || !B || !sig) return null;
  const up = B > S0, bb = Math.abs(Math.log(B / S0)), m = up ? mu : -mu, v = sig * Math.sqrt(T);
  if (bb === 0) return 1;
  if (Math.abs(m) < 1e-12) return 2 * N(-bb / v);
  return Math.min(1, N((-bb + m * T) / v) + Math.exp(2 * m * bb / (sig * sig)) * N((-bb - m * T) / v));
}

export const fprob = p => p == null ? '—' : p >= 0.995 ? '已到' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

// 每天收盤後算好的模型資料（坡度、晃動、模型評分），10 分鐘內重複使用
let cache = { at: 0, data: null };
export async function modelData() {
  if (cache.data && Date.now() - cache.at < 600_000) return cache.data;
  try {
    const r = await fetch('https://raw.githubusercontent.com/cyw714/stock-dashboard/main/model.json');
    cache = { at: Date.now(), data: (await r.json()).stocks ?? {} };
  } catch (e) {
    console.warn('讀不到 model.json：', e.message);
    cache.data ??= {};
  }
  return cache.data;
}
