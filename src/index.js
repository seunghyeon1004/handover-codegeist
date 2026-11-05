// Forge entry points: UI resolver, Rovo actions (also exposed through rovo:mcp), the weekly
// scheduled job and the async analysis consumer. Business logic lives in core.js and engine/.
import Resolver from '@forge/resolver';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { makeHttp } from './forge-env.js';
import {
  makeEnv, refreshSnapshot, currentSnapshot, makeKit, publishKit, recordAbsence, personFromQuery, weeklyRun, parseWindow,
} from './core.js';
import { listProjects, listSpaces } from './engine/collect.js';
import { getConfig, setConfig, getSnapshot, getAbsences, removeAbsence, getHistory, getKits } from './engine/store.js';
import { availability } from './engine/kit.js';

const asContext = (payload, ctx) => ({ cloudId: payload?.context?.cloudId || ctx?.cloudId, accountId: ctx?.accountId });

// ------------------------------------------------------------------------------------------------
// UI resolver
// ------------------------------------------------------------------------------------------------
const resolver = new Resolver();

resolver.define('getState', async ({ context }) => {
  const [config, snapshot, absences, history, kits] = await Promise.all([getConfig(), getSnapshot(), getAbsences(), getHistory(), getKits()]);
  return { config, snapshot: snapshot || null, absences, history, kits, me: context.accountId, now: Date.now() };
});

resolver.define('refresh', async ({ context }) => {
  const env = await makeEnv('user', context);
  const { snapshot } = await refreshSnapshot(env);
  return { snapshot };
});

resolver.define('queueRefresh', async () => {
  const queue = new Queue({ key: 'analysis-queue' });
  await queue.push({ requestedAt: Date.now() });
  return { queued: true };
});

resolver.define('getKit', async ({ payload, context }) => {
  const env = await makeEnv('user', context);
  const { kit } = await makeKit(env, payload);
  return { kit };
});

resolver.define('publishKit', async ({ payload, context }) => {
  const env = await makeEnv('user', context);
  return publishKit(env, payload);
});

resolver.define('addAbsence', async ({ payload, context }) => {
  const env = await makeEnv('user', context);
  return { absences: await recordAbsence(env, payload) };
});
resolver.define('removeAbsence', async ({ payload }) => { await removeAbsence(payload.personId, payload.from); return { absences: await getAbsences() }; });

resolver.define('saveConfig', async ({ payload }) => { await setConfig(payload); return { config: await getConfig() }; });

resolver.define('options', async ({ context }) => {
  const env = await makeEnv('user', context);
  const [projects, spaces] = await Promise.all([listProjects(env.http), listSpaces(env.http)]);
  return { projects, spaces };
});

resolver.define('runWeekly', async ({ context }) => weeklyRun(await makeEnv('user', context)));

// Issue panel: knowledge risk of the areas (components) this issue belongs to, from the stored snapshot.
resolver.define('issueRisk', async ({ context }) => {
  const key = context.extension?.issue?.key;
  const snapshot = await getSnapshot();
  if (!snapshot) return { empty: true, reason: 'No analysis yet. Open Handover from the Apps menu and press Analyse now.' };
  const http = makeHttp('user');
  const r = await http.jira('GET', `/rest/api/3/issue/${key}?fields=components,labels,assignee`);
  const comps = (r.json?.fields?.components || []).map((c) => c.name.toLowerCase().replace(/\s+/g, '-'));
  const absences = await getAbsences();
  const areas = snapshot.areas.filter((a) => comps.includes(a.name)).map((a) => ({
    name: a.name, risk: a.risk, level: a.level, busFactor: a.busFactor,
    owners: a.owners.slice(0, 3).map((o) => ({ name: o.name, share: o.share, away: absences.some((x) => x.personId === o.id && x.from <= Date.now() && x.to >= Date.now()) })),
  }));
  return { issueKey: key, areas, assignee: r.json?.fields?.assignee?.displayName || null };
});

resolver.define('resetState', async () => {
  for (const k of ['snapshot', 'absences', 'history', 'kits']) await kvs.delete(k);
  return { ok: true };
});

// Diagnostics: shows which product calls work as the user and as the app (helps admins fix permissions).
resolver.define('diagnose', async () => {
  const out = {};
  const tries = [
    ['jira-user', 'jira', 'user', '/rest/api/3/myself'],
    ['confluence-user-v2', 'confluence', 'user', '/wiki/api/v2/spaces?limit=1'],
    ['confluence-user-v1', 'confluence', 'user', '/wiki/rest/api/space?limit=1'],
    ['jira-app', 'jira', 'app', '/rest/api/3/project/search?maxResults=1'],
    ['confluence-app-v2', 'confluence', 'app', '/wiki/api/v2/spaces?limit=1'],
  ];
  for (const [name, product, mode, path] of tries) {
    try { const http = makeHttp(mode); const r = await http[product]('GET', path); out[name] = r.status; } catch (e) { out[name] = `error: ${e?.message || e}`; }
  }
  return out;
});

// Runs the read-only Rovo actions end to end so admins can verify the agent wiring without chatting.
resolver.define('testActions', async ({ context }) => {
  const ctx = { cloudId: context.cloudId, accountId: context.accountId };
  const report = await getSiloReport({}, ctx);
  const first = report.mostExposedPeople?.[0]?.name || 'unknown';
  const foot = await getPersonFootprint({ person: first }, ctx);
  const kit = await getHandoverKit({ person: first, from: '2026-12-01', to: '2026-12-08' }, ctx);
  const backup = await getBackupForArea({ area: report.areas?.[0]?.area || 'payments' }, ctx);
  return {
    report: { areas: report.areas?.length, top: report.areas?.[0]?.area, graph: report.graph },
    footprint: { person: foot.person, areas: foot.areas?.length },
    kit: { person: kit.person, summary: kit.summary, sample: kit.inFlight?.[0] },
    backup: { area: backup.area, recommendation: backup.recommendation },
  };
});

export const handler = resolver.getDefinitions();

// ------------------------------------------------------------------------------------------------
// Rovo actions (also the tools of the rovo:mcp module). Inputs come from the model, so a person is
// always re-resolved server side and no authorisation decision depends on a model-supplied id.
// ------------------------------------------------------------------------------------------------
const pct = (x) => `${Math.round(x * 100)}%`;
const areaBrief = (a) => ({
  area: a.name, risk: a.risk, level: a.level, busFactor: a.busFactor, concentration: pct(a.concentration), openIssues: a.openIssues,
  highPriorityOpen: a.highOpen, unownedPages: a.unownedPages,
  owners: a.owners.slice(0, 3).map((o) => ({ name: o.name, share: pct(o.share), openAssigned: o.assignedOpen, away: o.absent, graphConfirmed: !!o.graphConfirmed })),
});

export async function getSiloReport(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const snap = await currentSnapshot(env);
  let areas = snap.areas;
  if (payload?.area) areas = areas.filter((a) => a.name.includes(String(payload.area).toLowerCase().replace(/\s+/g, '-')));
  return {
    computedAt: new Date(snap.computedAt).toISOString(), stats: snap.stats, graph: snap.graph,
    areas: areas.slice(0, 8).map(areaBrief),
    mostExposedPeople: snap.people.filter((p) => p.exposure > 0).slice(0, 4).map((p) => ({ name: p.name, exposure: p.exposure, areas: p.ownedAreas.map((x) => `${x.name} (risk ${x.risk}, bus factor ${x.busFactor})`) })),
  };
}

export async function getPersonFootprint(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const r = await personFromQuery(env, payload.person);
  if (r.error) return r;
  const snap = r.snapshot;
  const areas = snap.areas.filter((a) => a.owners.some((o) => o.id === r.person.id && o.share >= 0.15));
  return {
    person: r.person.name, exposure: r.person.exposure, openAssigned: r.person.openAssigned, absent: !!r.person.absent,
    areas: areas.map((a) => ({ area: a.name, share: pct(a.owners.find((o) => o.id === r.person.id).share), isMainOwner: a.topOwnerId === r.person.id, risk: a.risk, busFactor: a.busFactor })),
  };
}

export async function getHandoverKit(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const r = await personFromQuery(env, payload.person);
  if (r.error) return r;
  const { kit } = await makeKit(env, { personId: r.person.id, from: payload.from, to: payload.to, reason: payload.reason });
  return {
    person: kit.person.name, window: { from: new Date(kit.window.from).toISOString().slice(0, 10), to: new Date(kit.window.to).toISOString().slice(0, 10) }, summary: kit.summary,
    areas: kit.whoToAsk.map((w) => ({ area: w.area, risk: w.risk, busFactor: w.busFactor, askInstead: w.people.slice(0, 2).map((p) => `${p.name} (${pct(p.share)}${p.available ? '' : ', away'})`) })),
    inFlight: kit.inFlight.slice(0, 10).map((i) => ({ key: i.key, summary: i.summary, status: i.status, priority: i.priority, due: i.due, nextStep: i.nextStep, suggestedOwner: i.suggestedOwner?.name || null })),
    decisions: kit.decisions.slice(0, 5).map((d) => ({ key: d.key, text: d.text })),
    risks: kit.risks.slice(0, 8).map((x) => x.text), followUps: kit.followUps.map((f) => f.title),
  };
}

export async function publishHandoverKit(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const r = await personFromQuery(env, payload.person);
  if (r.error) return r;
  const out = await publishKit(env, { personId: r.person.id, from: payload.from, to: payload.to, reason: payload.reason, createTasks: payload.createTasks !== false && payload.createTasks !== 'false', commentOnIssues: false });
  return { published: true, pageUrl: out.page.url, pageTitle: out.page.title, followUpTasks: out.tasks.map((t) => t.key ? `${t.key} ${t.title}` : `failed: ${t.title}`), summary: out.kit.summary };
}

export async function getBackupForArea(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const snap = await currentSnapshot(env);
  const q = String(payload.area || '').toLowerCase().replace(/\s+/g, '-');
  const area = snap.areas.find((a) => a.name === q) || snap.areas.find((a) => a.name.includes(q));
  if (!area) return { error: `No area matching "${payload.area}".`, areas: snap.areas.map((a) => a.name) };
  const absences = await getAbsences();
  const win = parseWindow({ from: payload.from, to: payload.to });
  return {
    area: area.name, busFactor: area.busFactor, risk: area.risk,
    people: area.owners.slice(0, 4).map((o) => ({ name: o.name, share: pct(o.share), available: availability(o.id, absences, win.from, win.to), openAssigned: o.assignedOpen })),
    recommendation: (() => { const b = area.owners.find((o, i) => i > 0 && availability(o.id, absences, win.from, win.to)); return b ? `${b.name} is the best available backup.` : 'No available backup: this is a critical gap.'; })(),
  };
}

export async function setAbsence(payload, ctx) {
  const env = await makeEnv('user', asContext(payload, ctx));
  const r = await personFromQuery(env, payload.person);
  if (r.error) return r;
  const list = await recordAbsence(env, { personId: r.person.id, from: payload.from, to: payload.to, reason: payload.reason });
  return { recorded: true, absences: list.map((a) => ({ person: a.personName, from: new Date(a.from).toISOString().slice(0, 10), to: new Date(a.to).toISOString().slice(0, 10), reason: a.reason })) };
}

// ------------------------------------------------------------------------------------------------
// Scheduled trigger and async consumer
// ------------------------------------------------------------------------------------------------
export async function weeklyJob(event) {
  const env = await makeEnv('app', { cloudId: event?.context?.cloudId });
  const result = await weeklyRun(env);
  console.log('weekly job', JSON.stringify(result));
}

export async function analysisConsumer() {
  const env = await makeEnv('app');
  await refreshSnapshot(env);
}
