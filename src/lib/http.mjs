// Copied from the engine (engine/lib/http.mjs) so this repo has no private code in it.
export class HttpError extends Error {
  constructor(label, status, detail) {
    super(`${label} failed: HTTP ${status}${detail ? ` — ${detail}` : ''}`);
    this.label = label;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * Number(process.env.RADAR_RETRY_SCALE ?? 1)));

// Retry at 2 s, 4 s, 8 s. `label` is used in errors instead of the URL, because the Telegram URL carries the token.
export async function request(label, url, init = {}, { delays = [2000, 4000, 8000], timeoutMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastError = new HttpError(label, 'network', err.name === 'TimeoutError' ? 'timeout' : err.message);
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      lastError = new HttpError(label, res.status, (await safeText(res)).slice(0, 200));
      continue;
    }
    return res;
  }
  throw lastError;
}

export async function requestJson(label, url, init, opts) {
  const res = await request(label, url, init, opts);
  const text = await safeText(res);
  if (!res.ok) throw new HttpError(label, res.status, text.slice(0, 300));
  try {
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  } catch {
    throw new HttpError(label, res.status, 'response was not JSON');
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
