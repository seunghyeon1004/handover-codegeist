// Runs the real engine against the dev site from the command line (basic auth), no Forge needed.
// Usage: node scripts/local-run.mjs [snapshot|kit "Maya Chen"]
import fs from 'node:fs';
import { api } from './lib.mjs';
import { collectAll } from '../src/engine/collect.js';
import { buildSnapshot } from '../src/engine/score.js';
import { buildKit } from '../src/engine/kit.js';
import { renderKitStorage, renderWeeklyStorage } from '../src/engine/publish.js';
import { resolvePerson } from '../src/engine/names.js';

const http = {
  jira: async (m, p, b) => { const r = await api(m, p, b, { allow: [400, 401, 403, 404, 409] }); return { status: r.status, json: r.data }; },
  confluence: async (m, p, b) => { const r = await api(m, p, b, { allow: [400, 401, 403, 404, 409] }); return { status: r.status, json: r.data }; },
};
const me = (await api('GET', '/rest/api/3/myself')).data.accountId;
const cfg = { projectKeys: ['NWP'], spaceKeys: ['NWP'], lookbackDays: 90, maxIssues: 500, ignoredAccountIds: [me] };
const siteUrl = `https://${process.env.SITE}`;
const { issues, pages, users } = await collectAll(http, cfg, siteUrl);
const snapshot = buildSnapshot({ issues, pages, users, cfg });
const mode = process.argv[2] || 'snapshot';
if (mode === 'snapshot') {
  console.log('issues', issues.length, 'pages', pages.length, 'people', Object.keys(users).length);
  for (const a of snapshot.areas) console.log(a.name.padEnd(14), 'risk', String(a.risk).padStart(3), a.level.padEnd(8), 'BF', a.busFactor, 'top', a.owners[0]?.name, Math.round(a.concentration * 100) + '%', 'open', a.openIssues, 'unownedPages', a.unownedPages);
  console.log('people', snapshot.people.map((p) => `${p.name}:${p.exposure}`).join(' | '));
} else {
  const hit = resolvePerson(process.argv[3], snapshot.people).match;
  const now = Date.now();
  const kit = buildKit({ snapshot, issues, pages, users, personId: hit.id, from: now + 7 * 864e5, to: now + 14 * 864e5, reason: 'Vacation', cfg });
  if (mode === 'kit') console.log(JSON.stringify({ summary: kit.summary, whoToAsk: kit.whoToAsk, inFlight: kit.inFlight.slice(0, 3), decisions: kit.decisions.slice(0, 3), risks: kit.risks, followUps: kit.followUps.map((f) => f.title) }, null, 1));
  if (mode === 'html') { fs.writeFileSync('/tmp/kit.html', renderKitStorage(kit)); console.log('wrote /tmp/kit.html', renderKitStorage(kit).length); }
}
