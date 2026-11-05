// Minimal Atlassian Document Format helpers.
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'mention') return node.attrs?.text || '@user';
  const inner = (node.content || []).map(adfToText).join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' ');
  return ['paragraph', 'heading', 'listItem', 'bulletList'].includes(node.type) ? inner + '\n' : inner;
}
export const textToAdf = (text) => ({
  type: 'doc', version: 1,
  content: String(text).split('\n').filter((l) => l.trim().length).map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })),
});
export const clip = (s, n = 220) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
