import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '_site');
const source = await readFile(new URL('./analytics.js', import.meta.url), 'utf8');
for (const site of ['gallery', 'tallinn-transit', 'pv-location', 'toompea-3d', 'battlefield-visibility', 'detailplaneering']) {
  const folder = site === 'gallery' ? root : path.join(root, site);
  const html = await readFile(path.join(folder, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)].filter(tag => tag[1].includes(`data-site="${site}"`));
  assert.equal(tags.length, 1, `${site}: expected one analytics bootstrap`);
  const attributes = tags[0][1];
  assert(!/\btype="module"/.test(attributes), `${site}: currentScript requires classic execution`);
  const src = attributes.match(/\bsrc="([^"]+)"/);
  if (src) {
    assert.equal(await readFile(path.resolve(folder, src[1]), 'utf8'), source, `${site}: stale analytics source`);
  } else {
    assert(html.includes(source), `${site}: missing inline analytics source`);
  }
  if (process.env.GITHUB_SHA && site !== 'gallery') {
    assert(attributes.includes(`data-release="${process.env.GITHUB_SHA}"`), `${site}: lost release attribution`);
  }
  console.log(`${site}: analytics bootstrap, source and attribution verified`);
}
