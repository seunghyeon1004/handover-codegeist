// Handover kit builder (pure). Takes the snapshot + raw issues/pages and a person, and returns a
// structured kit used by the UI preview, the Rovo actions and the Confluence publisher.
import { isOpen } from './score.js';
import { clip } from './adf.js';
import { parseSpeaker } from './names.js';

const DAY = 86400000;
const PRIORITY_ORDER = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
const DECISION_RE = /\b(decision|decided|agreed|we are going with|we're going with|going with|let'?s use|approved|must not|must never|never run|do not|don'?t|because)\b/i;
const NEXT_RE = /\bnext step\b[^:]*:\s*(.+)$/im;
const TRIBAL_RE = /(only known|only documented|private notes|owner'?s notes|only .{0,20}(knows|has)|not documented|todo: move|lives only)/i;

export function overlaps(a, from, to) { return a.from <= to && a.to >= from; }

export function availability(personId, absences, from, to) {
  return !absences.some((a) => a.personId === personId && overlaps(a, from, to));
}

function backupsFor(area, personId, absences, from, to, users) {
  return area.owners
    .filter((o) => o.id !== personId)
    .slice(0, 4)
    .map((o) => ({
      id: o.id, name: users[o.id]?.name || o.name, share: o.share, assignedOpen: o.assignedOpen, pages: o.pages,
      available: availability(o.id, absences, from, to),
    }));
}

export function buildKit({ snapshot, issues, pages, users, personId, from, to, reason = '', absences = [], now = Date.now(), cfg = {} }) {
  const ignored = new Set(cfg.ignoredAccountIds || []);
  const person = { id: personId, name: users[personId]?.name || personId };
  const people = snapshot.people.map((p) => ({ id: p.id, name: p.name }));
  const ownedAreas = snapshot.areas.filter((a) => a.owners.some((o) => o.id === personId && o.share >= 0.25));
  const topAreas = ownedAreas.filter((a) => a.topOwnerId === personId);

  // 1) in-flight work
  const mine = issues.filter((i) => isOpen(i) && i.assigneeId === personId);
  const areaByName = new Map(snapshot.areas.map((a) => [a.name, a]));
  const inFlight = mine
    .map((i) => {
      const area = areaByName.get(i.areas[0]);
      const backups = area ? backupsFor(area, personId, absences, from, to, users).filter((b) => b.available) : [];
      const lastComment = [...i.comments].sort((a, b) => b.created - a.created)[0];
      const daysSinceUpdate = Math.floor((now - i.updated) / DAY);
      const overdue = i.due ? Date.parse(i.due) < now : false;
      const dueInWindow = i.due ? Date.parse(i.due) <= to + 7 * DAY : false;
      return {
        key: i.key, summary: i.summary, status: i.status, priority: i.priority, due: i.due, overdue, dueInWindow,
        daysSinceUpdate, blocked: i.blocked, area: i.areas[0] || null, url: i.url,
        lastComment: lastComment ? clip(lastComment.text, 200) : null,
        nextStep: suggestNextStep(i, [...i.comments].sort((a, b) => b.created - a.created), { overdue, dueInWindow, daysSinceUpdate }),
        suggestedOwner: backups[0] ? { id: backups[0].id, name: backups[0].name } : null,
      };
    })
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (a.due || '9').localeCompare(b.due || '9'));

  // 2) decisions buried in comments (issues the person is assignee/reporter of, or spoke in)
  const decisions = [];
  for (const i of issues) {
    for (const c of i.comments) {
      const speaker = ignored.has(c.authorId) ? parseSpeaker(c.text, people) : c.authorId;
      const involved = speaker === personId || i.assigneeId === personId;
      if (!involved || !DECISION_RE.test(c.text)) continue;
      decisions.push({
        key: i.key, area: i.areas[0] || null, date: c.created, url: i.url, summary: i.summary,
        author: speaker && !ignored.has(speaker) ? users[speaker]?.name || c.authorName : null, text: cap1(clip(c.text.replace(/^[^:]*:\s*/, ''), 320)),
      });
    }
  }
  decisions.sort((a, b) => b.date - a.date);

  // 3) key pages
  const keyPages = pages
    .filter((p) => p.ownerIds.includes(personId) || p.creatorId === personId)
    .map((p) => ({
      id: p.id, title: p.title, url: p.url, area: p.areas[0] || null, updated: p.updated,
      role: p.ownerIds.includes(personId) ? 'owner' : 'creator',
      tribal: TRIBAL_RE.test(p.text || p.excerpt || ''),
    }));

  // 4) who to ask instead
  const whoToAsk = ownedAreas.map((a) => ({
    area: a.name, busFactor: a.busFactor, risk: a.risk,
    people: backupsFor(a, personId, absences, from, to, users),
  }));

  // 5) risks
  const risks = [];
  for (const i of inFlight) {
    if (i.overdue) risks.push({ severity: 'high', type: 'overdue', text: `${i.key} is overdue (${i.due}).`, ref: i.key, url: i.url });
    if (i.blocked) risks.push({ severity: 'high', type: 'blocked', text: `${i.key} is blocked: ${i.lastComment || i.summary}`, ref: i.key, url: i.url });
    else if (i.daysSinceUpdate >= 14 && i.status !== 'To Do') risks.push({ severity: 'medium', type: 'stale', text: `${i.key} has not moved for ${i.daysSinceUpdate} days.`, ref: i.key, url: i.url });
  }
  for (const a of topAreas) {
    const avail = backupsFor(a, personId, absences, from, to, users).filter((b) => b.available);
    const strongest = avail[0];
    if (!strongest || strongest.share < 0.2) {
      risks.push({ severity: 'high', type: 'no-backup', text: `${a.name}: nobody else carries more than ${Math.round((strongest?.share || 0) * 100)}% of the knowledge (bus factor ${a.busFactor}).`, ref: a.name });
    }
    if (a.unownedPages) risks.push({ severity: 'medium', type: 'unowned-pages', text: `${a.name}: ${a.unownedPages} page(s) have no owner.`, ref: a.name });
  }
  for (const p of keyPages.filter((p) => p.tribal)) {
    risks.push({ severity: 'medium', type: 'tribal-knowledge', text: `"${p.title}" says key details live outside the docs (private notes or one person's memory).`, ref: p.id, url: p.url });
  }

  // 6) follow-ups: one per critical/watch area, one per tribal page
  const followUps = [];
  for (const a of topAreas.filter((x) => x.level !== 'ok')) {
    const b = backupsFor(a, personId, absences, from, to, users).find((x) => x.available);
    followUps.push({
      kind: 'cover', area: a.name, assigneeId: b?.id || null, assigneeName: b?.name || null,
      title: `Cover ${a.name} while ${person.name} is out`,
      description: `${person.name} is the main owner of ${a.name} (bus factor ${a.busFactor}, risk ${a.risk}). Review the handover kit, confirm in-flight issues and pair on the first change.`,
      issueKeys: inFlight.filter((i) => i.area === a.name).map((i) => i.key),
    });
  }
  for (const p of keyPages.filter((p) => p.tribal)) {
    followUps.push({ kind: 'document', area: p.area, assigneeId: personId, assigneeName: person.name, title: `Document the missing details in "${p.title}"`, description: `The page says critical details are only in private notes. Capture them before ${person.name} is unavailable.`, issueKeys: [] });
  }

  return {
    person, window: { from, to, reason }, generatedAt: now,
    summary: {
      inFlight: inFlight.length, ownedAreas: topAreas.length, criticalAreas: topAreas.filter((a) => a.level === 'critical').length,
      decisions: decisions.length, pages: keyPages.length, risks: risks.length, followUps: followUps.length,
    },
    ownedAreas: ownedAreas.map((a) => ({ name: a.name, risk: a.risk, level: a.level, busFactor: a.busFactor, share: a.owners.find((o) => o.id === personId).share, isTop: a.topOwnerId === personId })),
    inFlight, decisions: decisions.slice(0, 12), pages: keyPages, whoToAsk, risks, followUps,
  };
}

function suggestNextStep(issue, commentsNewestFirst, { overdue, dueInWindow, daysSinceUpdate }) {
  const hit = commentsNewestFirst.map((c) => NEXT_RE.exec(c.text)).find(Boolean);
  const m = hit;
  if (m) return clip(m[1].replace(/^\(.*?\):\s*/, ''), 200);
  if (issue.blocked) return 'Unblock first: find out who or what the issue is waiting on and name an owner for that dependency.';
  if (issue.status === 'To Do') return overdue ? 'Overdue and not started: decide to reassign or re-plan.' : 'Not started: assign a temporary owner or defer explicitly.';
  if (overdue) return 'Overdue: confirm remaining scope and a new date with the stakeholder.';
  if (dueInWindow) return 'Due around the absence: someone must finish or hand over before the due date.';
  if (daysSinceUpdate >= 7) return 'No recent movement: ask for a status note before the handover.';
  return 'In progress: continue; owner should add a short status note on the issue.';
}

const cap1 = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
