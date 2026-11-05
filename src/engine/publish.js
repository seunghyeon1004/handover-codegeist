// Publishing: render kits and weekly reports as Confluence storage format and create the
// Jira follow-up tasks. All writes go through the same http adapter (asUser in the UI/agent).
import { textToAdf } from './adf.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const status = (title, colour) => `<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${esc(title)}</ac:parameter></ac:structured-macro>`;
// Plain names (not @mentions): mentions would notify people when a page is created for a preview or a demo.
const user = (_id, name) => `<strong>${esc(name || 'unassigned')}</strong>`;
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const levelColour = { critical: 'Red', watch: 'Yellow', ok: 'Green' };
const prioColour = { Highest: 'Red', High: 'Red', Medium: 'Yellow', Low: 'Grey', Lowest: 'Grey' };

const table = (headers, rows) =>
  `<table><tbody><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function renderKitStorage(kit) {
  const p = kit.person;
  const parts = [];
  parts.push(`<ac:structured-macro ac:name="info"><ac:rich-text-body><p><strong>Handover kit for ${user(p.id, p.name)}</strong> covering ${esc(fmtDate(kit.window.from))} to ${esc(fmtDate(kit.window.to))}${kit.window.reason ? ` (${esc(kit.window.reason)})` : ''}. Generated ${esc(fmtDate(kit.generatedAt))} by the Handover app from Jira, Confluence and Teamwork Graph activity.</p><p>${kit.summary.inFlight} in-flight issues, ${kit.summary.ownedAreas} area(s) where ${esc(p.name)} is the main owner (${kit.summary.criticalAreas} critical), ${kit.summary.decisions} decisions found in comments, ${kit.summary.risks} open risks.</p></ac:rich-text-body></ac:structured-macro>`);

  parts.push('<h2>1. Areas owned and who covers them</h2>');
  parts.push(table(['Area', 'Risk', 'Bus factor', `${esc(p.name)}'s share`, 'Ask instead'], kit.whoToAsk.map((w) => {
    const a = kit.ownedAreas.find((o) => o.name === w.area);
    const ask = w.people.length ? w.people.map((x) => `${user(x.id, x.name)} (${Math.round(x.share * 100)}%${x.available ? '' : ', away'})`).join('<br/>') : 'nobody yet';
    return [esc(w.area), status(`${a.risk} ${a.level}`, levelColour[a.level]), String(a.busFactor), `${Math.round(a.share * 100)}%`, ask];
  })));

  parts.push('<h2>2. In-flight work</h2>');
  parts.push(kit.inFlight.length ? table(['Issue', 'Status', 'Priority', 'Due', 'Next step', 'Suggested owner'], kit.inFlight.map((i) => [
    `${link(i.url, i.key)} ${esc(i.summary)}`, esc(i.status) + (i.blocked ? ' ' + status('BLOCKED', 'Red') : ''), status(i.priority, prioColour[i.priority] || 'Grey'),
    i.due ? esc(i.due) + (i.overdue ? ' ' + status('OVERDUE', 'Red') : '') : '-', esc(i.nextStep), i.suggestedOwner ? user(i.suggestedOwner.id, i.suggestedOwner.name) : '-',
  ])) : '<p>No open issues are assigned.</p>');

  parts.push('<h2>3. Decisions found in comments</h2>');
  parts.push(kit.decisions.length ? `<ul>${kit.decisions.map((d) => `<li>${link(d.url, d.key)} (${esc(d.area || 'no area')}, ${esc(fmtDate(d.date))}, ${esc(d.author || 'unknown')}): ${esc(d.text)}</li>`).join('')}</ul>` : '<p>No decision language found in recent comments.</p>');

  parts.push('<h2>4. Key pages</h2>');
  parts.push(kit.pages.length ? table(['Page', 'Area', 'Role', 'Last updated', 'Note'], kit.pages.map((pg) => [link(pg.url, pg.title), esc(pg.area || '-'), esc(pg.role), esc(fmtDate(pg.updated)), pg.tribal ? status('KNOWLEDGE OUTSIDE DOCS', 'Red') : ''])) : '<p>No pages are owned by this person.</p>');

  parts.push('<h2>5. Open risks</h2>');
  parts.push(kit.risks.length ? `<ul>${kit.risks.map((r) => `<li>${status(r.severity.toUpperCase(), r.severity === 'high' ? 'Red' : 'Yellow')} ${esc(r.text)}</li>`).join('')}</ul>` : '<p>No open risks detected.</p>');

  parts.push('<h2>6. Follow-ups</h2>');
  parts.push(kit.followUps.length ? `<ul>${kit.followUps.map((f) => `<li>${esc(f.title)}${f.assigneeId ? ' (' : ''}${f.assigneeId ? user(f.assigneeId, f.assigneeName) : ''}${f.assigneeId ? ')' : ''}</li>`).join('')}</ul>` : '<p>None.</p>');
  return parts.join('');
}

export function renderWeeklyStorage(snapshot, history = []) {
  const parts = [];
  const top = snapshot.areas.filter((a) => a.level !== 'ok');
  parts.push(`<ac:structured-macro ac:name="info"><ac:rich-text-body><p><strong>Weekly silo report</strong> generated ${esc(fmtDate(snapshot.computedAt))}. ${snapshot.stats.critical} critical area(s), ${snapshot.stats.singlePoints} area(s) with bus factor 1, ${snapshot.stats.unownedPages} page(s) without an owner.</p></ac:rich-text-body></ac:structured-macro>`);
  parts.push('<h2>Areas by silo risk</h2>');
  parts.push(table(['Area', 'Risk', 'Bus factor', 'Main owner', 'Open issues', 'Suggested pair'], snapshot.areas.map((a) => {
    const [o1, o2] = a.owners;
    return [esc(a.name), status(`${a.risk} ${a.level}`, levelColour[a.level]), String(a.busFactor), o1 ? `${user(o1.id, o1.name)} (${Math.round(o1.share * 100)}%)` : '-', String(a.openIssues), o2 ? user(o2.id, o2.name) : '<em>nobody yet</em>'];
  })));
  if (history.length > 1) {
    const prev = history[history.length - 2];
    parts.push('<h2>Trend</h2>');
    parts.push(`<p>Average risk ${prev.avgRisk} -> ${history[history.length - 1].avgRisk}; critical areas ${prev.critical} -> ${history[history.length - 1].critical}.</p>`);
  }
  parts.push('<h2>People exposure</h2>');
  parts.push(table(['Person', 'Exposure', 'Areas owned'], snapshot.people.filter((p) => p.exposure > 0).map((p) => [user(p.id, p.name), String(p.exposure), esc(p.ownedAreas.map((a) => `${a.name} (${a.risk})`).join(', '))])));
  if (top.length) parts.push(`<h2>Pairing suggestions</h2><ul>${top.slice(0, 5).map((a) => `<li><strong>${esc(a.name)}</strong>: pair ${a.owners[0] ? user(a.owners[0].id, a.owners[0].name) : 'the owner'} with ${a.owners[1] ? user(a.owners[1].id, a.owners[1].name) : 'a second engineer'} on the next change.</li>`).join('')}</ul>`);
  return parts.join('');
}

export async function createConfluencePage(http, { spaceId, title, storage, parentId }) {
  const attempt = async (t) => http.confluence('POST', '/wiki/api/v2/pages', { spaceId, status: 'current', title: t, ...(parentId ? { parentId } : {}), body: { representation: 'storage', value: storage } });
  let r = await attempt(title);
  if (r.status === 400 || r.status === 409) r = await attempt(`${title} (${new Date().toISOString().slice(11, 16)})`);
  if (r.status >= 300) throw new Error(`Confluence page creation failed (${r.status}): ${JSON.stringify(r.json).slice(0, 250)}`);
  return { id: r.json.id, title: r.json.title, url: `${r.json._links?.base || ''}${r.json._links?.webui || ''}` };
}

/** Update the weekly page in place when it already exists (same title in the space). */
export async function upsertConfluencePage(http, { spaceId, title, storage }) {
  const found = await http.confluence('GET', `/wiki/api/v2/spaces/${spaceId}/pages?title=${encodeURIComponent(title)}&limit=1`);
  const existing = found.json?.results?.[0];
  if (!existing) return createConfluencePage(http, { spaceId, title, storage });
  const r = await http.confluence('PUT', `/wiki/api/v2/pages/${existing.id}`, { id: existing.id, status: 'current', title, body: { representation: 'storage', value: storage }, version: { number: (existing.version?.number || 1) + 1, message: 'Weekly refresh' } });
  if (r.status >= 300) throw new Error(`Confluence page update failed (${r.status}): ${JSON.stringify(r.json).slice(0, 250)}`);
  return { id: existing.id, title, url: `${r.json._links?.base || ''}${r.json._links?.webui || ''}`, updated: true };
}

export async function resolveSpace(http, spaceKey) {
  if (spaceKey) {
    const r = await http.confluence('GET', `/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`);
    if (r.json?.results?.[0]) return r.json.results[0];
  }
  const r = await http.confluence('GET', '/wiki/api/v2/spaces?limit=25&status=current');
  const pick = (r.json?.results || []).find((s) => s.type === 'global');
  if (!pick) throw new Error('No Confluence space available to publish into. Set one in the Handover settings.');
  return pick;
}

export async function createFollowUps(http, { followUps, projectKey, pageUrl, personName, labels = ['handover'] }) {
  const created = [];
  for (const f of followUps) {
    const description = `${f.description}\n\nHandover kit: ${pageUrl}${f.issueKeys.length ? `\nRelated issues: ${f.issueKeys.join(', ')}` : ''}`;
    const fields = {
      project: { key: projectKey }, summary: f.title, issuetype: { name: 'Task' }, description: textToAdf(description), labels,
      ...(f.assigneeId ? { assignee: { accountId: f.assigneeId } } : {}),
    };
    const r = await http.jira('POST', '/rest/api/3/issue', { fields });
    if (r.status >= 300) { created.push({ title: f.title, error: JSON.stringify(r.json).slice(0, 200) }); continue; }
    created.push({ key: r.json.key, title: f.title, assigneeName: f.assigneeName });
  }
  return created;
}

export async function commentHandover(http, { issues, pageUrl, personName, windowText }) {
  const done = [];
  for (const i of issues) {
    const text = `Handover note: ${personName} is away ${windowText}.${i.suggestedOwner ? ` Suggested temporary owner: ${i.suggestedOwner.name}.` : ''} Next step: ${i.nextStep}\nFull kit: ${pageUrl}`;
    const r = await http.jira('POST', `/rest/api/3/issue/${i.key}/comment`, { body: textToAdf(text) });
    done.push({ key: i.key, ok: r.status < 300 });
  }
  return done;
}
