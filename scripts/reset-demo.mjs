// Resets the dev site for recording: follow-up tasks created by the app are archived (label swap + Done,
// because the demo project does not allow deleting issues), generated Confluence pages are removed.
// App-side data (absences, history) is cleared with "Clear stored data" in Handover > Settings.
import { api } from './lib.mjs';
const search = await api('POST', '/rest/api/3/search/jql', { jql: 'project = NWP AND labels in (handover, handover-pairing)', fields: ['summary', 'labels', 'status'], maxResults: 100 });
for (const i of search.data.issues || []) {
  const labels = i.fields.labels.filter((l) => !['handover', 'handover-pairing'].includes(l)).concat('handover-archived');
  await api('PUT', `/rest/api/3/issue/${i.key}`, { fields: { labels } });
  if (i.fields.status.statusCategory.key !== 'done') {
    const trs = (await api('GET', `/rest/api/3/issue/${i.key}/transitions`)).data.transitions;
    const t = trs.find((x) => x.to?.statusCategory?.key === 'done');
    if (t) await api('POST', `/rest/api/3/issue/${i.key}/transitions`, { transition: { id: t.id } });
  }
  console.log('archived', i.key);
}
const space = (await api('GET', '/wiki/api/v2/spaces?keys=NWP')).data.results[0];
const pages = (await api('GET', `/wiki/api/v2/spaces/${space.id}/pages?limit=100`)).data.results;
for (const p of pages.filter((x) => x.title.startsWith('Handover:') || x.title.startsWith('Weekly Silo Report'))) {
  await api('DELETE', `/wiki/api/v2/pages/${p.id}`, undefined, { allow: [404] }); console.log('deleted page', p.title);
}
