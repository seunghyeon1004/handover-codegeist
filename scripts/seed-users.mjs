// Creates the demo personas as invited users (plus-addresses of the owner mailbox).
import { api } from './lib.mjs';
import fs from 'node:fs';
const base = process.env.FORGE_EMAIL.split('@');
const personas = [
  ['maya.chen', 'Maya Chen'], ['diego.alvarez', 'Diego Alvarez'], ['priya.nair', 'Priya Nair'],
  ['tom.okafor', 'Tom Okafor'], ['lena.fischer', 'Lena Fischer'],
];
const out = {};
for (const [alias, name] of personas) {
  const email = `${base[0]}+${alias}@${base[1]}`;
  const found = await api('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
  let user = (found.data || []).find((u) => (u.emailAddress || '').toLowerCase() === email.toLowerCase());
  if (!user) user = (await api('POST', '/rest/api/3/user', { emailAddress: email, products: ['jira-software'] })).data;
  out[alias] = { name, email, accountId: user.accountId };
  console.log(name, user.accountId);
}
fs.writeFileSync(new URL('./personas.json', import.meta.url), JSON.stringify(out, null, 2));
