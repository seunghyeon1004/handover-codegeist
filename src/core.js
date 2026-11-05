// Use-cases shared by the UI resolver, Rovo actions, MCP tools and the weekly job.
import { makeHttp, makeGraph, siteUrl } from './forge-env.js';
import { analyse, compactSnapshot } from './engine/analysis.js';
import { buildKit } from './engine/kit.js';
import { renderKitStorage, renderWeeklyStorage, createConfluencePage, upsertConfluencePage, resolveSpace, createFollowUps, commentHandover } from './engine/publish.js';
import { resolvePerson } from './engine/names.js';
import { getConfig, getSnapshot, setSnapshot, getAbsences, addAbsence, pushHistory, getHistory, addKitRecord } from './engine/store.js';

const HOUR = 3600000;
const DAY = 86400000;

export async function makeEnv(mode = 'user', { cloudId } = {}) {
  const http = makeHttp(mode);
  const [cfg, absences] = await Promise.all([getConfig(), getAbsences()]);
  const graph = cfg.useGraph ? makeGraph(mode) : null;
  return { http, graph, cfg, absences, cloudId, siteUrl: await siteUrl(http) };
}

/** Full analysis; stores the compact snapshot. */
export async function refreshSnapshot(env) {
  const out = await analyse(env);
  const snap = compactSnapshot(out.snapshot);
  await setSnapshot(snap);
  return { ...out, snapshot: snap };
}

/** Stored snapshot if younger than maxAgeMs, otherwise recompute. */
export async function currentSnapshot(env, maxAgeMs = HOUR) {
  const stored = await getSnapshot();
  if (stored && Date.now() - stored.computedAt < maxAgeMs) return stored;
  return (await refreshSnapshot(env)).snapshot;
}

export function parseWindow({ from, to }) {
  const f = from ? Date.parse(from) : Date.now();
  const t = to ? Date.parse(to) + DAY - 1 : f + 7 * DAY;
  if (Number.isNaN(f) || Number.isNaN(t)) throw new Error('Dates must be ISO dates like 2026-12-01.');
  return { from: f, to: t };
}

export async function personFromQuery(env, query) {
  const snap = await currentSnapshot(env);
  const hit = resolvePerson(query, snap.people);
  if (hit.match) return { person: hit.match, snapshot: snap };
  if (hit.candidates) return { error: `More than one person matches "${query}". Use a full name.`, candidates: hit.candidates };
  return { error: `No person named "${query}" found in the analysed team.`, candidates: snap.people.slice(0, 8).map((p) => ({ id: p.id, name: p.name })) };
}

/** Fresh kit for a person and window. */
export async function makeKit(env, { personId, from, to, reason }) {
  const win = parseWindow({ from, to });
  const out = await analyse(env);
  const kit = buildKit({ snapshot: out.snapshot, issues: out.issues, pages: out.pages, users: out.users, personId, from: win.from, to: win.to, reason, absences: env.absences, cfg: env.cfg });
  await setSnapshot(compactSnapshot(out.snapshot));
  return { kit, snapshot: out.snapshot };
}

export async function publishKit(env, { personId, from, to, reason, createTasks = true, commentOnIssues = false }) {
  const { kit } = await makeKit(env, { personId, from, to, reason });
  const space = await resolveSpace(env.http, env.cfg.kitSpaceKey);
  const title = `Handover: ${kit.person.name} (${new Date(kit.window.from).toISOString().slice(0, 10)} to ${new Date(kit.window.to).toISOString().slice(0, 10)})`;
  const page = await createConfluencePage(env.http, { spaceId: space.id, title, storage: renderKitStorage(kit) });
  const pageUrl = page.url.startsWith('http') ? page.url : `${env.siteUrl}/wiki${page.url}`;
  let tasks = [];
  if (createTasks && kit.followUps.length) {
    const projectKey = env.cfg.followUpProjectKey || (kit.inFlight[0]?.key || '').split('-')[0] || (await env.http.jira('GET', '/rest/api/3/project/search?maxResults=1')).json?.values?.[0]?.key;
    tasks = await createFollowUps(env.http, { followUps: kit.followUps, projectKey, pageUrl, personName: kit.person.name });
  }
  let comments = [];
  if (commentOnIssues) comments = await commentHandover(env.http, { issues: kit.inFlight, pageUrl, personName: kit.person.name, windowText: `${new Date(kit.window.from).toISOString().slice(0, 10)} to ${new Date(kit.window.to).toISOString().slice(0, 10)}` });
  await addAbsence({ personId, personName: kit.person.name, from: kit.window.from, to: kit.window.to, reason: reason || '' });
  const record = { personId, personName: kit.person.name, pageUrl, pageTitle: page.title, at: Date.now(), tasks: tasks.map((t) => t.key).filter(Boolean) };
  await addKitRecord(record);
  return { page: { ...page, url: pageUrl }, tasks, comments, kit: { summary: kit.summary, person: kit.person, window: kit.window } };
}

export async function recordAbsence(env, { personId, from, to, reason }) {
  const win = parseWindow({ from, to });
  const snap = await currentSnapshot(env);
  const p = snap.people.find((x) => x.id === personId);
  return addAbsence({ personId, personName: p?.name || personId, from: win.from, to: win.to, reason: reason || '' });
}

/** Weekly job: recompute, publish/update the report page, create pairing tasks. */
export async function weeklyRun(env) {
  const out = await refreshSnapshot(env);
  const history = await pushHistory(out.snapshot);
  const result = { computedAt: out.snapshot.computedAt, critical: out.snapshot.stats.critical, page: null, tasks: [] };
  if (!env.cfg.weekly.enabled) return result;
  const space = await resolveSpace(env.http, env.cfg.kitSpaceKey);
  result.page = await upsertConfluencePage(env.http, { spaceId: space.id, title: 'Weekly Silo Report', storage: renderWeeklyStorage(out.snapshot, history) });
  if (env.cfg.weekly.createPairingTasks) {
    const open = await env.http.jira('POST', '/rest/api/3/search/jql', { jql: 'labels = "handover-pairing" AND statusCategory != Done', fields: ['summary'], maxResults: 50 });
    const existing = new Set((open.json?.issues || []).map((i) => i.fields.summary));
    const candidates = out.snapshot.areas.filter((a) => a.level !== 'ok' && a.owners.length >= 2).slice(0, env.cfg.weekly.maxPairingTasks);
    const projectKey = env.cfg.followUpProjectKey || (out.issues[0]?.key || '').split('-')[0];
    const followUps = candidates.map((a) => ({
      title: `Pairing: ${a.name} (${a.owners[0].name} + ${a.owners[1].name})`,
      description: `${a.name} has bus factor ${a.busFactor} and silo risk ${a.risk}. Pair ${a.owners[0].name} with ${a.owners[1].name} on the next change so the knowledge spreads.`,
      assigneeId: a.owners[1].id, assigneeName: a.owners[1].name, issueKeys: [],
    })).filter((f) => !existing.has(f.title));
    if (followUps.length && projectKey) result.tasks = await createFollowUps(env.http, { followUps, projectKey, pageUrl: `${env.siteUrl}/wiki${result.page.url}`, personName: '', labels: ['handover-pairing'] });
  }
  return result;
}

export { getHistory };
