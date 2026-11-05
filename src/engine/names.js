// Name helpers. Invited demo accounts show up as "owner+maya.chen"; real accounts keep
// their display name. prettyName turns the alias into "Maya Chen" so every surface
// (UI, agent replies, Confluence kit) reads naturally.

const titleCase = (s) => s.split(/[\s._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export function prettyName(displayName, email = '') {
  const raw = displayName || email || 'Unknown';
  if (raw.includes('+')) return titleCase(raw.split('+').slice(1).join('+'));
  if (/^[a-z0-9._-]+$/.test(raw) && raw.includes('.')) return titleCase(raw);
  return raw;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Resolve free text ("maya", "Maya Chen", an accountId) to people in the snapshot.
 * Returns { match } for one hit, { candidates } for several, {} for none.
 */
export function resolvePerson(query, people) {
  const q = norm(query);
  if (!q) return {};
  const exactId = people.find((p) => p.id === query);
  if (exactId) return { match: exactId };
  const exact = people.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return { match: exact[0] };
  const partial = people.filter((p) => norm(p.name).includes(q) || q.includes(norm(p.name).split(' ')[0]));
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { candidates: partial.map((p) => ({ id: p.id, name: p.name })) };
  return {};
}

/** Parse "Decision (Maya): ..." or "Maya: ..." speaker prefixes (comments posted through bridges/bots). */
export function parseSpeaker(text, people) {
  const m = /^\s*(?:[A-Za-z ]+\()?\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\)?\s*:/.exec(text || '');
  if (!m) return null;
  const hit = resolvePerson(m[1], people);
  return hit.match ? hit.match.id : null;
}
