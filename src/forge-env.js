// Forge runtime glue: builds the `http` and `graph` adapters used by the engine.
import api, { assumeTrustedRoute } from '@forge/api';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };

function wrap(requestFn) {
  return async (method, path, body) => {
    let res;
    try {
      res = await requestFn(assumeTrustedRoute(path), {
        method, headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      console.error(`request failed: ${method} ${path.slice(0, 80)} -> ${e?.message || e}`);
      throw e;
    }
    if (res.status >= 400) console.error(`http ${res.status}: ${method} ${path.slice(0, 80)}`);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  };
}

export function makeHttp(mode = 'user') {
  const c = mode === 'app' ? api.asApp() : api.asUser();
  return { jira: wrap((r, o) => c.requestJira(r, o)), confluence: wrap((r, o) => c.requestConfluence(r, o)) };
}

export function makeGraph(mode = 'user') {
  const c = mode === 'app' ? api.asApp() : api.asUser();
  if (typeof c.requestTeamworkGraph !== 'function') return null;
  return (query, variables) => c.requestTeamworkGraph(query, variables);
}

let cachedSite = null;
export async function siteUrl(http) {
  if (cachedSite) return cachedSite;
  const r = await http.jira('GET', '/rest/api/3/serverInfo');
  cachedSite = (r.json?.baseUrl || '').replace(/\/$/, '');
  return cachedSite;
}
