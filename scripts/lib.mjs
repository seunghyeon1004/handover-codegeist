// Tiny REST helper for the seed scripts. Credentials come from the environment
// (FORGE_EMAIL / FORGE_API_TOKEN, loaded via ../forge-env.sh) and are never printed.
const SITE = process.env.SITE; // e.g. your-dev-site.atlassian.net
if (!SITE) throw new Error('Set SITE=<your-site>.atlassian.net');
const AUTH = 'Basic ' + Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64');

export async function api(method, path, body, { allow = [] } = {}) {
  for (let attempt = 0; ; attempt++) {
  const res = await fetch(`https://${SITE}${path}`, {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 6) { await sleep(5000 * (attempt + 1)); continue; }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 500)}`);
  }
  return { status: res.status, data };
  }
}
export const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
