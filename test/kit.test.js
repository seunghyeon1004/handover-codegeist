import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../src/engine/score.js';
import { buildKit, availability } from '../src/engine/kit.js';
import { renderKitStorage } from '../src/engine/publish.js';
import { prettyName, resolvePerson, parseSpeaker } from '../src/engine/names.js';
import { parseOwners } from '../src/engine/collect.js';

const NOW = Date.UTC(2026, 10, 5);
const DAY = 86400000;
const mk = (key, area, who, over = {}) => ({
  key, areas: [area], assigneeId: who, reporterId: who, priority: 'High', status: 'In Progress', statusCategory: 'indeterminate',
  summary: `Task ${key}`, updated: NOW - 3 * DAY, created: NOW - 20 * DAY, due: null, blocked: false, url: `https://x/browse/${key}`, comments: [], ...over,
});
const users = { maya: { name: 'Maya Chen' }, diego: { name: 'Diego Alvarez' }, bot: { name: 'Bridge' } };
const issues = [
  ...[1, 2, 3, 4, 5, 6].map((n) => mk(`P-${n}`, 'payments', 'maya')),
  mk('P-7', 'payments', 'diego'),
  mk('P-8', 'payments', 'maya', { comments: [{ id: '1', authorId: 'bot', created: NOW - DAY, text: 'Decision (Maya): we are going with the v3 API because it has idempotency keys.' }, { id: '2', authorId: 'bot', created: NOW - DAY, text: 'Next step (Maya): finish the retry matrix.' }] }),
  mk('P-9', 'payments', 'maya', { due: '2026-11-01', blocked: true }),
];
const pages = [{ id: '1', title: 'Runbook', areas: ['payments'], creatorId: 'bot', ownerIds: ['maya'], created: NOW - 60 * DAY, updated: NOW - 30 * DAY, versions: [], url: 'https://x/wiki/1', text: 'Details live only in private notes.', excerpt: '' }];

test('kit lists in-flight work, decisions with speaker attribution, risks and follow-ups', () => {
  const cfg = { ignoredAccountIds: ['bot'] };
  const snapshot = buildSnapshot({ issues, pages, users, cfg, now: NOW });
  const kit = buildKit({ snapshot, issues, pages, users, personId: 'maya', from: NOW + DAY, to: NOW + 8 * DAY, absences: [], now: NOW, cfg });
  assert.equal(kit.person.name, 'Maya Chen');
  assert.equal(kit.inFlight.length, 8);
  assert.ok(kit.decisions.some((d) => /v3 API/.test(d.text)));
  assert.ok(kit.risks.some((r) => r.type === 'overdue'));
  assert.ok(kit.risks.some((r) => r.type === 'blocked'));
  assert.ok(kit.risks.some((r) => r.type === 'tribal-knowledge'));
  assert.ok(kit.followUps.some((f) => f.kind === 'cover' && f.assigneeId === 'diego'));
  const nextStep = kit.inFlight.find((i) => i.key === 'P-8').nextStep;
  assert.match(nextStep, /retry matrix/);
});

test('absent backups are not suggested', () => {
  const cfg = { ignoredAccountIds: ['bot'] };
  const snapshot = buildSnapshot({ issues, pages, users, cfg, now: NOW });
  const absences = [{ personId: 'diego', from: NOW, to: NOW + 30 * DAY }];
  const kit = buildKit({ snapshot, issues, pages, users, personId: 'maya', from: NOW + DAY, to: NOW + 8 * DAY, absences, now: NOW, cfg });
  assert.ok(kit.inFlight.every((i) => !i.suggestedOwner));
  assert.equal(availability('diego', absences, NOW + DAY, NOW + 2 * DAY), false);
});

test('confluence storage rendering escapes content', () => {
  const cfg = { ignoredAccountIds: ['bot'] };
  const snapshot = buildSnapshot({ issues, pages, users, cfg, now: NOW });
  const kit = buildKit({ snapshot, issues, pages, users, personId: 'maya', from: NOW, to: NOW + DAY, now: NOW, cfg });
  kit.person.name = 'Maya <script>';
  const html = renderKitStorage(kit);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('ac:structured-macro'));
});

test('names: aliases are prettified and people resolved by partial name', () => {
  assert.equal(prettyName('demo+maya.chen'), 'Maya Chen');
  assert.equal(prettyName('Maya Chen'), 'Maya Chen');
  const people = [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Diego Alvarez' }];
  assert.equal(resolvePerson('maya', people).match.id, 'a');
  assert.equal(resolvePerson('Alvarez', people).match.id, 'b');
  assert.deepEqual(resolvePerson('nobody', people), {});
  assert.equal(parseSpeaker('Decision (Diego): use tokens', people), 'b');
});

test('page owners are parsed from the Owner line only', () => {
  const html = '<p><strong>Owner:</strong> <ac:link><ri:user ri:account-id="u1" /></ac:link></p><p>Reviewed by <ac:link><ri:user ri:account-id="u2" /></ac:link></p>';
  assert.deepEqual(parseOwners(html), ['u1']);
});
