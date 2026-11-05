import test from 'node:test';
import assert from 'node:assert/strict';
import { busFactor, concentrationFactor, decay, buildSnapshot } from '../src/engine/score.js';

const NOW = Date.UTC(2026, 10, 5);
const issue = (key, area, assigneeId, over = {}) => ({
  key, areas: [area], assigneeId, reporterId: assigneeId, priority: 'High', statusCategory: 'indeterminate',
  updated: NOW - 2 * 86400000, created: NOW - 10 * 86400000, comments: [], ...over,
});

test('busFactor picks the smallest group covering the threshold', () => {
  assert.equal(busFactor([0.8, 0.1, 0.1], 0.5), 1);
  assert.equal(busFactor([0.4, 0.35, 0.25], 0.5), 2);
  assert.equal(busFactor([0.2, 0.2, 0.2, 0.2, 0.2], 0.5), 3);
  assert.equal(busFactor([0.5, 0.5], 0.5), 2);
});

test('concentrationFactor is 0 below 50% and 1 from 90%', () => {
  assert.equal(concentrationFactor(0.4), 0);
  assert.equal(concentrationFactor(0.95), 1);
  assert.ok(Math.abs(concentrationFactor(0.7) - 0.5) < 1e-9);
});

test('decay halves every half-life', () => {
  const d = decay(NOW - 60 * 86400000, NOW, 60);
  assert.ok(Math.abs(d - 0.5) < 1e-9);
});

test('a single-owner area with open high priority work is critical', () => {
  const issues = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => issue(`A-${n}`, 'payments', 'maya'));
  const snap = buildSnapshot({ issues, pages: [], users: { maya: { name: 'Maya' } }, now: NOW });
  const a = snap.areas[0];
  assert.equal(a.busFactor, 1);
  assert.equal(a.level, 'critical');
  assert.equal(snap.people[0].id, 'maya');
});

test('a shared area is not a silo', () => {
  const issues = [
    ...[1, 2, 3, 4].map((n) => issue(`B-${n}`, 'auth', 'diego')),
    ...[5, 6, 7, 8].map((n) => issue(`B-${n}`, 'auth', 'priya')),
  ];
  const snap = buildSnapshot({ issues, pages: [], now: NOW });
  assert.equal(snap.areas[0].busFactor, 2);
  assert.ok(snap.areas[0].concentration <= 0.55);
  assert.equal(snap.areas[0].level, 'ok');
});

test('ignored accounts never count as owners', () => {
  const issues = [1, 2, 3].map((n) => issue(`C-${n}`, 'infra', 'admin', { reporterId: 'admin' }));
  issues.push(issue('C-9', 'infra', 'lena'));
  const snap = buildSnapshot({ issues, pages: [], cfg: { ignoredAccountIds: ['admin'] }, now: NOW });
  assert.equal(snap.areas[0].owners.length, 1);
  assert.equal(snap.areas[0].owners[0].id, 'lena');
});

test('page owners add knowledge and unowned pages are flagged', () => {
  const pages = [
    { id: '1', title: 'Runbook', areas: ['settlement'], creatorId: 'x', ownerIds: ['maya'], created: NOW, updated: NOW, versions: [] },
    { id: '2', title: 'FAQ', areas: ['settlement'], creatorId: 'x', ownerIds: [], created: NOW, updated: NOW, versions: [] },
  ];
  const snap = buildSnapshot({ issues: [issue('S-1', 'settlement', 'maya')], pages, cfg: { ignoredAccountIds: ['x'] }, now: NOW });
  const a = snap.areas.find((s) => s.name === 'settlement');
  assert.equal(a.unownedPages, 1);
  assert.equal(a.owners[0].pages, 1);
});

test('absent top owner increases the risk', () => {
  const issues = [1, 2, 3, 4, 5].map((n) => issue(`D-${n}`, 'x', 'maya'));
  const base = buildSnapshot({ issues, pages: [], now: NOW }).areas[0].risk;
  const out = buildSnapshot({ issues, pages: [], now: NOW, absences: [{ personId: 'maya', from: NOW - 1000, to: NOW + 1000 }] }).areas[0].risk;
  assert.ok(out > base);
});
