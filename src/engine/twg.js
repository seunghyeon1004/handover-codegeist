// Teamwork Graph consumption. Uses curated queries (no registration needed):
//   atlassianUserAssignedJiraWorkItems(userId)  -> work items the graph says a user is assigned
//   confluencePageContributors(id)               -> users the graph says contributed to a page
// The graph is additive: the engine works from REST alone and uses the graph to confirm links
// ("graph-confirmed") and to find extra footprint. Errors degrade gracefully and are reported.

const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;
const pageAri = (cloudId, id) => `ari:cloud:confluence:${cloudId}:page/${id}`;

const ASSIGNED = `query handover_assigned($userId: ID!, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: 25, after: $after) {
    edges { node { ... on JiraWorkItem { id key summary } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CONTRIBUTORS = `query handover_contributors($id: ID!) {
  confluencePageContributors(id: $id, first: 25) {
    edges { node { ... on AtlassianUser { id accountId name } } }
  }
}`;

async function run(graph, query, variables) {
  const res = await graph(query, variables);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; ').slice(0, 300));
  return json.data;
}

/** Returns { byUser: {accountId: Set(keys)}, error?: string, calls } */
export async function graphAssignedWork(graph, accountIds, { maxPages = 4 } = {}) {
  const byUser = {};
  let calls = 0;
  try {
    for (const id of accountIds) {
      const keys = new Set();
      let after = null;
      for (let page = 0; page < maxPages; page++) {
        const data = await run(graph, ASSIGNED, { userId: userAri(id), after });
        calls++;
        const conn = data.atlassianUserAssignedJiraWorkItems;
        for (const e of conn?.edges || []) if (e.node?.key) keys.add(e.node.key);
        if (!conn?.pageInfo?.hasNextPage) break;
        after = conn.pageInfo.endCursor;
      }
      byUser[id] = keys;
    }
    return { byUser, calls };
  } catch (e) {
    return { byUser, calls, error: e.message };
  }
}

export async function graphPageContributors(graph, cloudId, pageIds) {
  const byPage = {};
  let calls = 0;
  try {
    for (const id of pageIds) {
      const data = await run(graph, CONTRIBUTORS, { id: pageAri(cloudId, id) });
      calls++;
      byPage[id] = (data.confluencePageContributors?.edges || []).map((e) => e.node?.accountId || e.node?.id).filter(Boolean);
    }
    return { byPage, calls };
  } catch (e) {
    return { byPage, calls, error: e.message };
  }
}

/**
 * Cross-check REST-derived ownership with the graph. Marks owners as graphConfirmed when the graph
 * lists at least one of their assigned items in that area, and reports extra graph-only items.
 */
export function applyGraph(snapshot, issues, graphAssigned) {
  const keyArea = new Map(issues.map((i) => [i.key, i.areas]));
  let confirmed = 0;
  let extra = 0;
  for (const area of snapshot.areas) {
    for (const o of area.owners) {
      const keys = graphAssigned.byUser[o.id];
      if (!keys) continue;
      const inArea = [...keys].filter((k) => (keyArea.get(k) || []).includes(area.name));
      o.graphItems = inArea.length;
      o.graphConfirmed = inArea.length > 0;
      if (o.graphConfirmed) confirmed++;
      extra += [...keys].filter((k) => !keyArea.has(k)).length;
    }
  }
  snapshot.graph = { used: true, confirmedLinks: confirmed, extraItems: extra, calls: graphAssigned.calls, error: graphAssigned.error || null };
  return snapshot;
}
