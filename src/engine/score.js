// Pure scoring logic for Handover. No Forge or network calls in this file so it
// can be unit tested with plain fixtures (see test/score.test.js).
//
// Input  : normalised issues and pages (see collect.js for the shapes) + config.
// Output : a "snapshot" with one entry per area (bus factor, risk, owners) and
//          one entry per person (exposure).

export const DEFAULT_CONFIG = {
  halfLifeDays: 60,        // older activity counts less: w * 0.5^(age / halfLife)
  busFactorThreshold: 0.5, // top-k people covering this share define the bus factor
  criticalRisk: 60,        // risk score at or above this is "Critical"
  watchRisk: 35,           // risk score at or above this is "Watch"
  weights: {
    assignee: 3,
    reporter: 1,
    comment: 1.5,
    commentCapPerIssue: 5,
    pageCreator: 3,
    pageVersion: 1,
    pageVersionCap: 5,
    pageOwner: 4,
  },
  ignoredAccountIds: [],   // service accounts, admins, bots
};

const DAY = 86400000;

/** Exponential decay factor for an event that happened at `ts` (ms since epoch). */
export function decay(ts, now, halfLifeDays) {
  if (!ts) return 1;
  const ageDays = Math.max(0, (now - ts) / DAY);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Is the issue still open (not in the "done" status category)? */
export const isOpen = (issue) => issue.statusCategory !== 'done';

/**
 * Turn issues + pages into touch events: { person, area, weight, kind, ref, ts }.
 * One issue can belong to several areas (components); the weight is split so a
 * multi-component issue does not count several times over.
 */
export function buildEvents(issues, pages, cfg, now) {
  const w = cfg.weights;
  const ignored = new Set(cfg.ignoredAccountIds || []);
  const events = [];
  const push = (person, area, weight, kind, ref, ts) => {
    if (!person || !area || ignored.has(person)) return;
    events.push({ person, area, weight: weight * decay(ts, now, cfg.halfLifeDays), kind, ref, ts });
  };

  for (const issue of issues) {
    const areas = issue.areas.length ? issue.areas : [issue.project || 'unassigned'];
    const share = 1 / areas.length;
    const ts = issue.updated || issue.created;
    for (const area of areas) {
      push(issue.assigneeId, area, w.assignee * share, 'assignee', issue.key, ts);
      push(issue.reporterId, area, w.reporter * share, 'reporter', issue.key, issue.created);
      const perPerson = {};
      for (const c of issue.comments || []) {
        const who = c.speakerId || c.authorId;
        perPerson[who] = (perPerson[who] || 0) + 1;
        if (perPerson[who] <= w.commentCapPerIssue) push(who, area, w.comment * share, 'comment', issue.key, c.created);
      }
    }
  }

  for (const page of pages) {
    for (const area of page.areas) {
      push(page.creatorId, area, w.pageCreator, 'pageCreator', page.id, page.created);
      const perPerson = {};
      for (const v of page.versions || []) {
        perPerson[v.authorId] = (perPerson[v.authorId] || 0) + 1;
        if (perPerson[v.authorId] <= w.pageVersionCap) push(v.authorId, area, w.pageVersion, 'pageVersion', page.id, v.created);
      }
      for (const owner of page.ownerIds || []) push(owner, area, w.pageOwner, 'pageOwner', page.id, page.updated || page.created);
    }
  }
  return events;
}

/** Smallest k such that the top-k people hold more than the threshold share (default: more than half). */
export function busFactor(sortedShares, threshold) {
  let acc = 0;
  for (let i = 0; i < sortedShares.length; i++) {
    acc += sortedShares[i];
    if (acc > threshold + 1e-9) return i + 1; // must cover MORE than half of the knowledge
  }
  return sortedShares.length || 0;
}

/** Concentration -> 0..1: 0 below 50% top share, 1 at 90% and above. */
export function concentrationFactor(topShare) {
  return Math.min(1, Math.max(0, (topShare - 0.5) / 0.4));
}

/**
 * Criticality 0..1 of an area from its open work: volume, high priority, and
 * how recently it moved. Deliberately simple and explainable.
 */
export function criticality(areaIssues, now) {
  const open = areaIssues.filter(isOpen);
  const high = open.filter((i) => ['Highest', 'High'].includes(i.priority));
  const recent = areaIssues.filter((i) => i.updated && now - i.updated < 14 * DAY);
  const volume = Math.min(1, open.length / 8);
  const urgency = Math.min(1, high.length / 3);
  const activity = Math.min(1, recent.length / 6);
  return Number((0.4 * volume + 0.4 * urgency + 0.2 * activity).toFixed(3));
}

export function buildSnapshot({ issues, pages, users = {}, cfg: cfgIn = {}, now = Date.now(), absences = [] }) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgIn, weights: { ...DEFAULT_CONFIG.weights, ...(cfgIn.weights || {}) } };
  const events = buildEvents(issues, pages, cfg, now);
  const absentNow = new Set(absences.filter((a) => a.from <= now && now <= a.to).map((a) => a.personId));

  // Group events per area then per person.
  const byArea = new Map();
  for (const e of events) {
    if (!byArea.has(e.area)) byArea.set(e.area, new Map());
    const m = byArea.get(e.area);
    const rec = m.get(e.person) || { person: e.person, score: 0, kinds: {} };
    rec.score += e.weight;
    rec.kinds[e.kind] = (rec.kinds[e.kind] || 0) + 1;
    m.set(e.person, rec);
  }

  const areaNames = new Set([...byArea.keys(), ...issues.flatMap((i) => i.areas)]);
  const areas = [];
  for (const name of areaNames) {
    const people = [...(byArea.get(name)?.values() || [])].sort((a, b) => b.score - a.score);
    const total = people.reduce((s, p) => s + p.score, 0) || 1;
    const owners = people.map((p) => ({
      id: p.person, name: users[p.person]?.name || p.person, share: Number((p.score / total).toFixed(3)),
      assignedOpen: issues.filter((i) => i.areas.includes(name) && isOpen(i) && i.assigneeId === p.person).length,
      pages: pages.filter((pg) => pg.areas.includes(name) && (pg.ownerIds.includes(p.person) || pg.creatorId === p.person)).length,
      kinds: p.kinds, absent: absentNow.has(p.person),
    }));
    const shares = owners.map((o) => o.share);
    const top = shares[0] || 0;
    const bf = busFactor(shares, cfg.busFactorThreshold);
    const areaIssues = issues.filter((i) => i.areas.includes(name));
    const crit = criticality(areaIssues, now);
    // Silo risk: how critical the work is x how concentrated the knowledge is.
    // An absent top owner pushes the risk up (the silo is exposed right now).
    let risk = 100 * crit * concentrationFactor(top);
    if (owners[0]?.absent) risk = Math.min(100, risk * 1.25 + 10);
    const areaPages = pages.filter((pg) => pg.areas.includes(name));
    areas.push({
      name, busFactor: bf, concentration: Number(top.toFixed(3)), criticality: crit, risk: Math.round(risk),
      level: risk >= cfg.criticalRisk ? 'critical' : risk >= cfg.watchRisk ? 'watch' : 'ok',
      openIssues: areaIssues.filter(isOpen).length, totalIssues: areaIssues.length,
      highOpen: areaIssues.filter((i) => isOpen(i) && ['Highest', 'High'].includes(i.priority)).length,
      owners, topOwnerId: owners[0]?.id || null,
      pages: areaPages.map((p) => ({ id: p.id, title: p.title, url: p.url, ownerIds: p.ownerIds, updated: p.updated, unowned: !p.ownerIds.length })),
      unownedPages: areaPages.filter((p) => !p.ownerIds.length).length,
    });
  }
  areas.sort((a, b) => b.risk - a.risk || a.busFactor - b.busFactor);

  // Per-person exposure: sum of risk of areas where the person is the top owner.
  const people = new Map();
  for (const a of areas) for (const o of a.owners) {
    const p = people.get(o.id) || { id: o.id, name: o.name, exposure: 0, ownedAreas: [], areas: 0, openAssigned: 0, absent: o.absent };
    p.areas += 1; p.openAssigned += o.assignedOpen;
    if (o.id === a.topOwnerId) { p.exposure += a.risk; p.ownedAreas.push({ name: a.name, risk: a.risk, busFactor: a.busFactor, share: o.share }); }
    people.set(o.id, p);
  }
  const peopleList = [...people.values()].sort((a, b) => b.exposure - a.exposure);

  return {
    computedAt: now,
    areas, people: peopleList,
    stats: {
      issues: issues.length, pages: pages.length, people: peopleList.length, areas: areas.length,
      critical: areas.filter((a) => a.level === 'critical').length,
      singlePoints: areas.filter((a) => a.busFactor === 1).length,
      unownedPages: pages.filter((p) => !p.ownerIds.length).length,
    },
  };
}
