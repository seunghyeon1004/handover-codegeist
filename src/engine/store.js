// Persistence on Forge Key-Value Store. Keys are small and few; the snapshot never contains raw
// issue bodies so it stays well below the KVS value limit.
import { kvs } from '@forge/kvs';
import { DEFAULT_CONFIG } from './score.js';

export const DEFAULT_APP_CONFIG = {
  projectKeys: [],            // empty = every project the user can see
  spaceKeys: [],              // empty = every non-personal space
  useGraph: false,            // consult Teamwork Graph (needs the read:graph:* scopes)
  lookbackDays: 90,
  maxIssues: 1000,
  nameOverrides: {},          // accountId -> display name, for accounts whose profile name is not useful
  ignoredAccountIds: [],      // service accounts or admins that should never be treated as owners
  kitSpaceKey: '',            // where handover pages go (empty = first configured/visible space)
  followUpProjectKey: '',     // where follow-up tasks go (empty = project of the first in-flight issue)
  weekly: { enabled: true, createPairingTasks: true, maxPairingTasks: 3 },
  weights: DEFAULT_CONFIG.weights,
};

export async function getConfig() {
  const saved = (await kvs.get('config')) || {};
  return { ...DEFAULT_APP_CONFIG, ...saved, weekly: { ...DEFAULT_APP_CONFIG.weekly, ...(saved.weekly || {}) } };
}
export const setConfig = (cfg) => kvs.set('config', cfg);

export const getSnapshot = () => kvs.get('snapshot');
export const setSnapshot = (snap) => kvs.set('snapshot', snap);

export async function getAbsences() { return (await kvs.get('absences')) || []; }
export async function addAbsence(a) {
  const list = await getAbsences();
  const next = [...list.filter((x) => !(x.personId === a.personId && x.from === a.from && x.to === a.to)), a];
  await kvs.set('absences', next);
  return next;
}
export async function removeAbsence(personId, from) {
  const list = await getAbsences();
  await kvs.set('absences', list.filter((x) => !(x.personId === personId && x.from === from)));
}

export async function getHistory() { return (await kvs.get('history')) || []; }
/** Keep a compact trend point per run (last 12). */
export async function pushHistory(snapshot) {
  const point = {
    t: snapshot.computedAt, critical: snapshot.stats.critical, singlePoints: snapshot.stats.singlePoints,
    avgRisk: Math.round(snapshot.areas.reduce((s, a) => s + a.risk, 0) / Math.max(1, snapshot.areas.length)),
    areas: Object.fromEntries(snapshot.areas.map((a) => [a.name, a.risk])),
  };
  const h = [...(await getHistory()), point].slice(-12);
  await kvs.set('history', h);
  return h;
}

export const getKits = async () => (await kvs.get('kits')) || [];
export async function addKitRecord(rec) {
  const kits = [rec, ...(await getKits())].slice(0, 20);
  await kvs.set('kits', kits);
  return kits;
}
