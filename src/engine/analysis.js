// Orchestrates one analysis run: collect -> score -> graph cross-check.
import { collectAll } from './collect.js';
import { buildSnapshot } from './score.js';
import { graphAssignedWork, applyGraph } from './twg.js';

export async function analyse(env) {
  const { http, graph, siteUrl, cfg, absences } = env;
  const { issues, pages, users } = await collectAll(http, cfg, siteUrl);
  const snapshot = buildSnapshot({ issues, pages, users, cfg, absences });
  if (graph) {
    const ids = snapshot.people.slice(0, 12).map((p) => p.id);
    const assigned = await graphAssignedWork(graph, ids);
    applyGraph(snapshot, issues, assigned);
  } else {
    snapshot.graph = { used: false };
  }
  snapshot.siteUrl = siteUrl;
  return { snapshot, issues, pages, users };
}

/** Compact snapshot for storage: drop per-owner `kinds` detail we do not need to persist. */
export function compactSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot, (k, v) => (k === 'kinds' ? undefined : v)));
}
