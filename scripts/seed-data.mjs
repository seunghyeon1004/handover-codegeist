// Seeds the "Northwind Payments" demo team: project NWP (company-managed kanban),
// components, ~74 issues with skewed ownership, comments with decision language,
// a Confluence space with runbooks/ADRs that name owners via @mentions.
// Idempotent: re-running skips what already exists (label seed-handover on issues).
import fs from 'node:fs';
import { api, adf, sleep } from './lib.mjs';

const personas = JSON.parse(fs.readFileSync(new URL('./personas.json', import.meta.url)));
let skipped = 0;
const P = (k) => personas[k].accountId;
const me = (await api('GET', '/rest/api/3/myself')).data.accountId;
const PROJECT = 'NWP';

// ---- project + components -------------------------------------------------
let proj = (await api('GET', `/rest/api/3/project/${PROJECT}`, undefined, { allow: [404] }));
if (proj.status === 404) {
  proj = await api('POST', '/rest/api/3/project', {
    key: PROJECT, name: 'Northwind Payments', projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-kanban-template',
    leadAccountId: me, description: 'Demo team for the Handover app (payments platform).',
  });
  console.log('project created');
  await sleep(4000);
}
const components = ['payments-core', 'settlement', 'auth', 'api-gateway', 'data-pipeline', 'mobile-app', 'infra-ci'];
const existingComps = (await api('GET', `/rest/api/3/project/${PROJECT}/components`)).data.map((c) => c.name);
for (const c of components) {
  if (!existingComps.includes(c)) await api('POST', '/rest/api/3/component', { name: c, project: PROJECT, description: `Area: ${c}` });
}

// ---- issues ----------------------------------------------------------------
// [component, summary, assignee, reporter, priority, status, dueOffsetDays|null, labels[], comments[]]
const D = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const issues = [];
const add = (component, summary, assignee, reporter, priority, status, due, labels = [], comments = []) =>
  issues.push({ component, summary, assignee, reporter, priority, status, due, labels, comments });

// payments-core: Maya carries almost everything
add('payments-core', 'Migrate card authorisation to new acquirer API', 'maya.chen', 'maya.chen', 'Highest', 'In Progress', 6, [], [
  'Decision (Maya): we are going with the acquirer v3 REST API, not the ISO 8583 gateway, because certification takes 6 weeks and v3 supports idempotency keys natively.',
  'Next step (Maya): finish the retry matrix for 5xx vs timeout, then run the shadow-traffic comparison on staging before the cut-over window.',
  'Blocked on the sandbox credentials renewal; ops ticket filed, expected Thursday.']);
add('payments-core', 'Idempotency key collisions on retry storms', 'maya.chen', 'diego.alvarez', 'Highest', 'In Progress', -3, ['incident-followup'], [
  'Agreed: keys are scoped per merchant + request hash, TTL 24h. We must not reuse keys across merchants.',
  'Maya: root cause is the retry middleware regenerating keys after a timeout. Fix is in branch fix/idempotency-scope, needs a load test.']);
add('payments-core', 'Chargeback webhook handler drops duplicate events', 'maya.chen', 'maya.chen', 'High', 'To Do', 10, [], []);
add('payments-core', 'Refund API: partial refunds over 90 days', 'maya.chen', 'tom.okafor', 'High', 'In Progress', 14, [], [
  'Decision (Maya): partial refunds older than 90 days go through manual review. Finance approved this on Monday.']);
add('payments-core', 'PCI scope review for tokenisation service', 'maya.chen', 'maya.chen', 'High', 'To Do', 21, ['compliance'], []);
add('payments-core', 'Add currency rounding rules for JPY and KWD', 'maya.chen', 'maya.chen', 'Medium', 'Done', null, [], []);
add('payments-core', 'Dead-letter queue replay tooling', 'maya.chen', 'maya.chen', 'Medium', 'Done', null, [], []);
add('payments-core', 'Rotate acquirer signing keys', 'maya.chen', 'maya.chen', 'High', 'Done', null, [], []);
add('payments-core', 'Ledger write amplification on high-volume merchants', 'maya.chen', 'diego.alvarez', 'High', 'In Progress', 4, [], [
  'Next step: batch ledger writes per authorisation window; benchmark with the 10k TPS profile before merging.']);
add('payments-core', 'Document payment state machine', 'maya.chen', 'maya.chen', 'Medium', 'To Do', -10, ['docs'], []);
add('payments-core', 'Feature flags cleanup for legacy 3DS flow', 'diego.alvarez', 'maya.chen', 'Low', 'To Do', null, [], []);
add('payments-core', 'Add structured logging to auth pipeline', 'diego.alvarez', 'maya.chen', 'Low', 'Done', null, [], []);
add('payments-core', 'Sandbox merchant fixtures', 'maya.chen', 'maya.chen', 'Low', 'Done', null, [], []);
add('payments-core', 'Latency budget for the authorise endpoint', 'maya.chen', 'maya.chen', 'Medium', 'Done', null, [], []);

// settlement: Maya again, Lena once
add('settlement', 'Nightly settlement job fails on DST change', 'maya.chen', 'lena.fischer', 'Highest', 'In Progress', 2, ['blocked'], [
  'Decision: settlement runs at 02:30 UTC fixed, never local time. DST is not allowed to move the window.',
  'Blocked: need the bank cut-off calendar for 2027; only Maya has the contact at the settlement bank.']);
add('settlement', 'Reconciliation mismatches for partial captures', 'maya.chen', 'maya.chen', 'High', 'In Progress', -2, [], [
  'Next step: add a tolerance of 1 minor unit for FX-converted captures, then re-run the March backlog.']);
add('settlement', 'Settlement report export for finance', 'maya.chen', 'maya.chen', 'Medium', 'To Do', 20, [], []);
add('settlement', 'Bank file format change (ISO 20022)', 'maya.chen', 'maya.chen', 'High', 'To Do', 30, ['compliance'], []);
add('settlement', 'Retry policy for failed payouts', 'maya.chen', 'maya.chen', 'Medium', 'Done', null, [], []);
add('settlement', 'Payout ledger snapshot job', 'maya.chen', 'maya.chen', 'Medium', 'Done', null, [], []);
add('settlement', 'Reconcile settlement reports with bank statements', 'maya.chen', 'maya.chen', 'High', 'Done', null, [], []);
add('settlement', 'Alert on missing settlement file', 'lena.fischer', 'maya.chen', 'Medium', 'Done', null, [], []);

// auth: Diego + Priya share (bus factor 2)
add('auth', 'Token rotation without downtime', 'diego.alvarez', 'diego.alvarez', 'High', 'In Progress', 8, [], [
  'Decision (Diego): dual-key window of 15 minutes, old key stays valid but is flagged in logs.']);
add('auth', 'Refresh token reuse detection', 'priya.nair', 'diego.alvarez', 'High', 'In Progress', 12, [], []);
add('auth', 'Passkey support spike', 'diego.alvarez', 'tom.okafor', 'Medium', 'To Do', 25, [], []);
add('auth', 'Rate limit login attempts per IP and account', 'priya.nair', 'diego.alvarez', 'High', 'Done', null, [], []);
add('auth', 'Session cookie SameSite audit', 'diego.alvarez', 'diego.alvarez', 'Medium', 'Done', null, [], []);
add('auth', 'OIDC provider migration', 'diego.alvarez', 'maya.chen', 'High', 'In Progress', -5, [], []);
add('auth', 'Admin MFA enforcement', 'priya.nair', 'diego.alvarez', 'Medium', 'To Do', null, [], []);
add('auth', 'Auth service load test', 'priya.nair', 'priya.nair', 'Low', 'Done', null, [], []);
add('auth', 'Revoke tokens on password change', 'diego.alvarez', 'diego.alvarez', 'Medium', 'Done', null, [], []);
add('auth', 'Audit log retention policy', 'maya.chen', 'priya.nair', 'Low', 'To Do', null, [], []);

// api-gateway: Diego dominates
add('api-gateway', 'Per-merchant rate limits', 'diego.alvarez', 'maya.chen', 'High', 'In Progress', 5, [], [
  'Decision (Diego): token bucket per merchant, 600 rpm default, burst x2. Enterprise tier configured via the gateway config repo only.']);
add('api-gateway', 'Gateway timeout tuning for settlement endpoints', 'diego.alvarez', 'lena.fischer', 'Medium', 'To Do', 15, [], []);
add('api-gateway', 'Request signing v2', 'diego.alvarez', 'diego.alvarez', 'High', 'In Progress', 9, [], [
  'Next step: roll out v2 signing to sandbox first, keep v1 accepted until the partner migration finishes.']);
add('api-gateway', 'Deprecate v1 webhooks', 'diego.alvarez', 'diego.alvarez', 'Medium', 'To Do', 40, [], []);
add('api-gateway', 'Gateway config validation in CI', 'diego.alvarez', 'lena.fischer', 'Medium', 'Done', null, [], []);
add('api-gateway', 'CORS rules for partner portals', 'diego.alvarez', 'diego.alvarez', 'Low', 'Done', null, [], []);
add('api-gateway', 'Public API changelog automation', 'tom.okafor', 'diego.alvarez', 'Low', 'Done', null, [], []);
add('api-gateway', 'Gateway canary release process', 'lena.fischer', 'diego.alvarez', 'Medium', 'To Do', null, [], []);

// data-pipeline: Priya
add('data-pipeline', 'Backfill events table after schema change', 'priya.nair', 'priya.nair', 'Highest', 'In Progress', 3, [], [
  'Decision (Priya): backfill in 7-day partitions, oldest first, with the dedup step enabled. Do not run two backfills at once, it locks the warehouse.',
  'Next step: finish partitions for Q1, then verify row counts against the source dump.']);
add('data-pipeline', 'Daily revenue DAG intermittently late', 'priya.nair', 'maya.chen', 'High', 'In Progress', -1, ['blocked'], [
  'Blocked: waiting for the upstream vendor export; Priya has the vendor contact and the manual re-trigger steps.']);
add('data-pipeline', 'Data quality checks for merchant dimension', 'priya.nair', 'priya.nair', 'High', 'To Do', 12, [], []);
add('data-pipeline', 'Warehouse cost review', 'priya.nair', 'priya.nair', 'Medium', 'To Do', 28, [], []);
add('data-pipeline', 'Migrate legacy cron jobs to the orchestrator', 'priya.nair', 'priya.nair', 'Medium', 'In Progress', 18, [], []);
add('data-pipeline', 'Partition pruning for the events table', 'priya.nair', 'priya.nair', 'Medium', 'Done', null, [], []);
add('data-pipeline', 'PII masking in analytics views', 'priya.nair', 'maya.chen', 'High', 'Done', null, ['compliance'], []);
add('data-pipeline', 'Self-service dashboards for finance', 'priya.nair', 'priya.nair', 'Low', 'Done', null, [], []);
add('data-pipeline', 'Schema registry rollout', 'priya.nair', 'priya.nair', 'Medium', 'Done', null, [], []);
add('data-pipeline', 'Orchestrator upgrade to the new major version', 'priya.nair', 'lena.fischer', 'Medium', 'Done', null, [], []);
add('data-pipeline', 'Alerting for stale DAGs', 'priya.nair', 'priya.nair', 'Medium', 'Done', null, [], []);
add('data-pipeline', 'Export job for tax reporting', 'tom.okafor', 'priya.nair', 'Low', 'Done', null, [], []);

// mobile-app: Tom + Diego + Priya
add('mobile-app', 'Biometric payment confirmation', 'tom.okafor', 'tom.okafor', 'High', 'In Progress', 11, [], [
  'Decision (Tom): use the platform biometric prompt, no custom UI. Fallback is device PIN only, never our own PIN.']);
add('mobile-app', 'App Store release 5.3 checklist', 'tom.okafor', 'tom.okafor', 'High', 'In Progress', 7, [], []);
add('mobile-app', 'Offline mode for payment history', 'tom.okafor', 'diego.alvarez', 'Medium', 'To Do', 35, [], []);
add('mobile-app', 'Crash on Android 14 when scanning QR', 'diego.alvarez', 'tom.okafor', 'High', 'In Progress', -4, [], []);
add('mobile-app', 'Deep links for payment requests', 'tom.okafor', 'tom.okafor', 'Medium', 'Done', null, [], []);
add('mobile-app', 'Accessibility audit fixes', 'tom.okafor', 'tom.okafor', 'Medium', 'Done', null, [], []);
add('mobile-app', 'Push notification opt-in flow', 'priya.nair', 'tom.okafor', 'Low', 'Done', null, [], []);
add('mobile-app', 'Analytics events for checkout funnel', 'priya.nair', 'tom.okafor', 'Low', 'To Do', null, [], []);
add('mobile-app', 'Localisation: Spanish and German', 'tom.okafor', 'tom.okafor', 'Low', 'To Do', null, [], []);
add('mobile-app', 'Upgrade to the latest UI toolkit', 'diego.alvarez', 'tom.okafor', 'Medium', 'To Do', null, [], []);
add('mobile-app', 'Mobile API error handling guidelines', 'tom.okafor', 'tom.okafor', 'Low', 'Done', null, [], []);
add('mobile-app', 'Tablet layout for dashboards', 'tom.okafor', 'tom.okafor', 'Low', 'To Do', null, [], []);

// infra-ci: Lena + Diego + Tom
add('infra-ci', 'Runner autoscaling for the CI fleet', 'lena.fischer', 'lena.fischer', 'High', 'In Progress', 10, [], [
  'Decision (Lena): spot runners for unit tests, on-demand runners for release builds. Release builds must never run on spot capacity.']);
add('infra-ci', 'Flaky integration tests quarantine', 'lena.fischer', 'diego.alvarez', 'Medium', 'To Do', 16, [], []);
add('infra-ci', 'Terraform state migration', 'lena.fischer', 'lena.fischer', 'High', 'In Progress', -6, [], [
  'Next step: lock state, migrate the production workspace last, and keep a state backup per workspace.']);
add('infra-ci', 'Cache dependencies across pipelines', 'diego.alvarez', 'lena.fischer', 'Medium', 'Done', null, [], []);
add('infra-ci', 'On-call rotation tooling', 'lena.fischer', 'lena.fischer', 'Medium', 'Done', null, [], []);
add('infra-ci', 'Secrets scanning in CI', 'lena.fischer', 'maya.chen', 'High', 'Done', null, ['compliance'], []);
add('infra-ci', 'Build time regression dashboard', 'tom.okafor', 'lena.fischer', 'Low', 'To Do', null, [], []);
add('infra-ci', 'Container image signing', 'diego.alvarez', 'lena.fischer', 'Medium', 'To Do', 22, [], []);
add('infra-ci', 'Disaster recovery drill', 'lena.fischer', 'lena.fischer', 'High', 'To Do', 45, [], []);
add('infra-ci', 'Reduce artifact storage cost', 'lena.fischer', 'lena.fischer', 'Low', 'Done', null, [], []);

const existing = (await api('POST', '/rest/api/3/search/jql', { jql: `project = ${PROJECT} AND labels = seed-handover`, fields: ['summary'], maxResults: 100 })).data;
const have = new Set((existing.issues || []).map((i) => i.fields.summary));
const transitionsCache = {};
const doneNames = ['Done'];
let created = 0;
for (const it of issues) {
  if (have.has(it.summary)) continue;
  if (!personas[it.assignee] || !personas[it.reporter]) { skipped++; continue; }
  const fields = {
    project: { key: PROJECT }, summary: it.summary, issuetype: { name: 'Task' },
    description: adf(`${it.summary}. Area: ${it.component}. Owner on record: ${personas[it.assignee].name}.`),
    components: [{ name: it.component }], labels: ['seed-handover', ...it.labels],
    priority: { name: it.priority }, assignee: { accountId: P(it.assignee) },
  };
  if (it.due !== null) fields.duedate = D(it.due);
  const r = await api('POST', '/rest/api/3/issue', { fields }, { allow: [400] });
  if (r.status === 400) { console.log('create failed', it.summary, JSON.stringify(r.data).slice(0, 300)); continue; }
  const key = r.data.key; created++;
  // Reporter is not on the create screen of this project; try to set it afterwards (best effort).
  await api('PUT', `/rest/api/3/issue/${key}`, { fields: { reporter: { accountId: P(it.reporter) } } }, { allow: [400, 403] });
  for (const c of it.comments) await api('POST', `/rest/api/3/issue/${key}/comment`, { body: adf(c) });
  if (created % 10 === 0) console.log('created', created, key);
}
// Reconcile workflow status (works with any locale: pick the transition by status category).
const want = new Map(issues.map((i) => [i.summary, i.status]));
const all = (await api('POST', '/rest/api/3/search/jql', { jql: `project = ${PROJECT} AND labels = seed-handover`, fields: ['summary', 'status'], maxResults: 100 })).data.issues;
let moved = 0;
for (const i of all) {
  const target = want.get(i.fields.summary);
  const cat = i.fields.status.statusCategory.key;
  const wantCat = target === 'Done' ? 'done' : target === 'In Progress' ? 'indeterminate' : 'new';
  if (cat === wantCat) continue;
  const trs = (await api('GET', `/rest/api/3/issue/${i.key}/transitions`)).data.transitions;
  const t = trs.find((x) => x.to?.statusCategory?.key === wantCat);
  if (t) { await api('POST', `/rest/api/3/issue/${i.key}/transitions`, { transition: { id: t.id } }); moved++; }
}
console.log('status transitions applied:', moved);
console.log('issues created:', created, 'skipped (persona missing):', skipped, 'total defined:', issues.length);
fs.writeFileSync(new URL('./seed-output.json', import.meta.url), JSON.stringify({ project: PROJECT, issuesDefined: issues.length }, null, 2));
