// Data collection for Handover. Everything goes through an `http` adapter so the same code
// runs inside Forge (api.asUser / api.asApp) and in local scripts (basic auth fetch):
//   http.jira(method, path, body?)        -> { status, json }
//   http.confluence(method, path, body?)  -> { status, json }
import { adfToText, clip } from './adf.js';
import { prettyName } from './names.js';

const AREA_LABEL = /^area[:\-_]/i;
const slug = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, '-');

export async function listProjects(http) {
  const r = await http.jira('GET', '/rest/api/3/project/search?maxResults=50');
  return (r.json?.values || []).map((p) => ({ key: p.key, name: p.name }));
}

export async function listSpaces(http) {
  const r = await http.confluence('GET', '/wiki/api/v2/spaces?limit=50&status=current');
  return (r.json?.results || []).filter((s) => s.type !== 'personal' && s.type !== 'collaboration').map((s) => ({ id: s.id, key: s.key, name: s.name }));
}

/** Issues updated or still open in the lookback window. Returns normalised issue objects. */
export async function fetchIssues(http, { projectKeys, lookbackDays = 90, maxIssues = 1000, siteUrl = '' }) {
  const projects = projectKeys?.length ? projectKeys : (await listProjects(http)).map((p) => p.key);
  if (!projects.length) return [];
  const jql = `project in (${projects.map((k) => `"${k}"`).join(',')}) AND (statusCategory != Done OR updated >= -${lookbackDays}d) AND (labels is EMPTY OR labels not in (handover, handover-pairing, handover-archived)) ORDER BY updated DESC`;
  const fields = ['summary', 'status', 'priority', 'assignee', 'reporter', 'duedate', 'components', 'labels', 'updated', 'created', 'resolutiondate', 'comment', 'project', 'issuetype'];
  const out = [];
  let nextPageToken;
  do {
    const r = await http.jira('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) });
    if (r.status >= 400) throw new Error(`Jira search failed (${r.status}): ${JSON.stringify(r.json).slice(0, 200)}`);
    for (const i of r.json.issues || []) out.push(normaliseIssue(i, siteUrl));
    nextPageToken = r.json.nextPageToken;
  } while (nextPageToken && out.length < maxIssues);
  return out;
}

// Status names follow the user's language; show the English category when the name is not ASCII.
const CAT = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' };
export const englishStatus = (st) => (st && /^[\x20-\x7E]*$/.test(st.name || '') ? st.name : CAT[st?.statusCategory?.key] || st?.name);

export function normaliseIssue(i, siteUrl = '') {
  const f = i.fields || {};
  const labels = f.labels || [];
  const areas = (f.components || []).map((c) => slug(c.name));
  for (const l of labels) if (AREA_LABEL.test(l)) areas.push(slug(l.replace(AREA_LABEL, '')));
  return {
    id: i.id, key: i.key, summary: f.summary, project: f.project?.key, issueType: f.issuetype?.name,
    status: englishStatus(f.status), statusCategory: f.status?.statusCategory?.key, priority: f.priority?.name || 'Medium',
    assigneeId: f.assignee?.accountId || null, assigneeName: f.assignee?.displayName || null,
    reporterId: f.reporter?.accountId || null, due: f.duedate || null, labels, areas: [...new Set(areas)],
    created: Date.parse(f.created), updated: Date.parse(f.updated), resolved: f.resolutiondate ? Date.parse(f.resolutiondate) : null,
    blocked: labels.some((l) => /block/i.test(l)),
    url: `${siteUrl}/browse/${i.key}`,
    comments: (f.comment?.comments || []).map((c) => ({
      id: c.id, authorId: c.author?.accountId, authorName: c.author?.displayName, created: Date.parse(c.created),
      text: clip(adfToText(c.body), 600),
    })),
  };
}

/** Confluence pages (v2 API) with labels, versions (contributors) and owner mentions. */
export async function fetchPages(http, { spaceKeys, knownAreas = [], maxPages = 300, siteUrl = '', excludeTitlePrefixes = ['Handover:', 'Weekly Silo Report'] }) {
  const allSpaces = await listSpaces(http);
  const spaces = spaceKeys?.length ? allSpaces.filter((s) => spaceKeys.includes(s.key)) : allSpaces;
  const known = new Set(knownAreas);
  const raw = [];
  for (const space of spaces) {
    let path = `/wiki/api/v2/spaces/${space.id}/pages?limit=100&body-format=storage&status=current`;
    while (path && raw.length < maxPages) {
      const r = await http.confluence('GET', path);
      if (r.status >= 400) throw new Error(`Confluence pages failed (${r.status}): ${JSON.stringify(r.json).slice(0, 200)}`);
      for (const p of r.json.results || []) if (!excludeTitlePrefixes.some((x) => p.title.startsWith(x))) raw.push({ p, space });
      const next = r.json._links?.next;
      path = next ? (next.startsWith('/wiki') ? next : `/wiki${next}`) : null;
    }
  }
  const pages = [];
  // Labels and versions need one call each; run them in small parallel batches.
  for (let i = 0; i < raw.length; i += 8) {
    const batch = raw.slice(i, i + 8);
    const extra = await Promise.all(batch.map(async ({ p }) => {
      const [labels, versions] = await Promise.all([
        http.confluence('GET', `/wiki/api/v2/pages/${p.id}/labels?limit=50`),
        http.confluence('GET', `/wiki/api/v2/pages/${p.id}/versions?limit=50`),
      ]);
      return { labels: (labels.json?.results || []).map((l) => l.name), versions: (versions.json?.results || []).map((v) => ({ authorId: v.authorId, created: Date.parse(v.createdAt) })) };
    }));
    batch.forEach(({ p, space }, idx) => {
      const { labels, versions } = extra[idx];
      const areas = labels.map((l) => (AREA_LABEL.test(l) ? slug(l.replace(AREA_LABEL, '')) : slug(l))).filter((l) => known.has(l));
      const storage = p.body?.storage?.value || '';
      pages.push({
        id: String(p.id), title: p.title, spaceKey: space.key, areas: [...new Set(areas)], labels,
        creatorId: p.authorId || null, created: Date.parse(p.createdAt),
        updated: Date.parse(p.version?.createdAt || p.createdAt), lastEditorId: p.version?.authorId || null,
        ownerIds: parseOwners(storage), versions,
        url: `${siteUrl}/wiki${p._links?.webui || ''}`,
        excerpt: clip(storage.replace(/<[^>]+>/g, ' '), 260),
        text: clip(storage.replace(/<[^>]+>/g, ' '), 1800),
      });
    });
  }
  return pages;
}

/** "Owner: @Name" (or Maintainer / DRI) lines name the page owners. */
export function parseOwners(storage) {
  const owners = new Set();
  for (const p of storage.split('</p>')) {
    const text = p.replace(/<[^>]+>/g, ' ').trim();
    if (/^(owner|maintainer|dri|owned by)s?\b/i.test(text)) {
      for (const m of p.matchAll(/ri:account-id="([^"]+)"/g)) owners.add(m[1]);
    }
  }
  return [...owners];
}

/** accountId -> { name, email, active } for every id we saw. */
export async function resolveUsers(http, ids, overrides = {}) {
  const out = {};
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const qs = chunk.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const r = await http.jira('GET', `/rest/api/3/user/bulk?${qs}&maxResults=50`);
    for (const u of r.json?.values || []) out[u.accountId] = { name: prettyName(u.displayName, u.emailAddress), email: u.emailAddress || null, active: u.active, accountType: u.accountType };
  }
  for (const id of list) if (!out[id]) out[id] = { name: id, email: null, active: false, accountType: 'unknown' };
  for (const [id, name] of Object.entries(overrides || {})) if (out[id]) out[id].name = name;
  return out;
}

export async function collectAll(http, cfg, siteUrl = '') {
  const issues = await fetchIssues(http, { projectKeys: cfg.projectKeys, lookbackDays: cfg.lookbackDays, maxIssues: cfg.maxIssues, siteUrl });
  const knownAreas = [...new Set(issues.flatMap((i) => i.areas))];
  const pages = await fetchPages(http, { spaceKeys: cfg.spaceKeys, knownAreas, siteUrl });
  const ids = [
    ...issues.flatMap((i) => [i.assigneeId, i.reporterId, ...i.comments.map((c) => c.authorId)]),
    ...pages.flatMap((p) => [p.creatorId, p.lastEditorId, ...p.ownerIds, ...p.versions.map((v) => v.authorId)]),
  ];
  const users = await resolveUsers(http, ids, cfg.nameOverrides);
  return { issues, pages, users };
}
