// Seeds a Confluence space "NWP" with runbooks and ADRs. Owners are named with
// @mentions on an "Owner:" line and each page is labelled with its area.
import fs from 'node:fs';
import { api, sleep } from './lib.mjs';

const personas = JSON.parse(fs.readFileSync(new URL('./personas.json', import.meta.url)));
const mention = (k) => `<ac:link><ri:user ri:account-id="${personas[k].accountId}" /></ac:link>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let space = (await api('GET', '/wiki/api/v2/spaces?keys=NWP')).data.results?.[0];
if (!space) {
  const r = await api('POST', '/wiki/rest/api/space', { key: 'NWP', name: 'Northwind Payments', description: { plain: { value: 'Runbooks, ADRs and notes for the payments team.', representation: 'plain' } } });
  space = { id: r.data.id };
  await sleep(3000);
}
const spaceId = String(space.id);
console.log('space', spaceId);

const pages = [
  ['payments-core', 'Payments Core: architecture and runbook', 'maya.chen', [
    'The payments core authorises card payments through the acquirer API and writes every state change to the ledger.',
    'Runbook: if authorisation latency exceeds the budget, check the acquirer status page, then the retry middleware dashboards. Do not restart the ledger writer during a settlement window.',
    'Contacts: the acquirer technical account manager is only known to the owner of this page.']],
  ['payments-core', 'ADR-014: Idempotency keys and retries', 'maya.chen', [
    'Decision: idempotency keys are scoped per merchant and request hash with a 24 hour TTL.',
    'Consequence: retries after a timeout must reuse the stored key. Regenerating keys causes duplicate authorisations.']],
  ['payments-core', 'Chargeback handling playbook', 'maya.chen', [
    'Chargebacks arrive as webhooks. Duplicates are expected; the handler must be idempotent on the dispute id.',
    'Escalate disputes above 5000 USD to finance the same day.']],
  ['settlement', 'Nightly settlement job: runbook', 'maya.chen', [
    'The settlement job runs at 02:30 UTC and produces the bank file. If it fails, do not re-run it twice: duplicate bank files cause double payouts.',
    'The manual re-run procedure and the bank contact list live only in the owner\'s notes. TODO: move them here.']],
  ['settlement', 'Settlement reconciliation FAQ', null, [
    'Common mismatch causes: FX rounding, partial captures, late refunds. No owner assigned.']],
  ['auth', 'Auth service overview', 'diego.alvarez', [
    'Auth issues short-lived access tokens and rotating refresh tokens. Keys rotate every 90 days.']],
  ['auth', 'Token rotation procedure', 'priya.nair', [
    'Rotation uses a 15 minute dual-key window. Verify the JWKS endpoint serves both keys before retiring the old one.']],
  ['api-gateway', 'API gateway rate-limit configuration', 'diego.alvarez', [
    'Rate limits are token buckets per merchant. Defaults are in the gateway config repo; enterprise overrides are applied by hand.']],
  ['data-pipeline', 'Data pipeline DAGs and backfill guide', 'priya.nair', [
    'Backfills run in 7-day partitions with dedup enabled. Never run two backfills concurrently.',
    'The vendor export contact and the manual trigger steps are documented only in private notes.']],
  ['data-pipeline', 'Warehouse schema notes', 'priya.nair', [
    'Events table is partitioned by day. Merchant dimension is a type 2 slowly changing dimension.']],
  ['mobile-app', 'Mobile release checklist', 'tom.okafor', [
    'Release train: freeze on Tuesday, store review submitted Wednesday. Biometric flows need a device lab pass.']],
  ['infra-ci', 'CI pipeline and runner fleet', 'lena.fischer', [
    'Unit tests run on spot runners; release builds run on on-demand runners only.']],
  ['infra-ci', 'On-call guide', 'lena.fischer', [
    'Primary on-call carries the pager for one week. Escalation path: primary, secondary, engineering manager.']],
];

const existing = (await api('GET', `/wiki/api/v2/spaces/${spaceId}/pages?limit=100`)).data.results.map((p) => p.title);
let n = 0;
for (const [area, title, owner, paras] of pages) {
  if (existing.includes(title)) continue;
  if (owner && !personas[owner]) { console.log('skip (persona missing):', title); continue; }
  const body = `<p><strong>Area:</strong> ${esc(area)}</p>` +
    `<p><strong>Owner:</strong> ${owner ? mention(owner) : 'unassigned'}</p>` +
    paras.map((p) => `<p>${esc(p)}</p>`).join('');
  const r = await api('POST', '/wiki/api/v2/pages', { spaceId, status: 'current', title, body: { representation: 'storage', value: body } });
  const id = r.data.id;
  await api('POST', `/wiki/rest/api/content/${id}/label`, [{ prefix: 'global', name: area }, { prefix: 'global', name: 'seed-handover' }]);
  n++;
}
console.log('pages created', n);
