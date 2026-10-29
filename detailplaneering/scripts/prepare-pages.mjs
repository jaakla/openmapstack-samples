// Publish the verified canonical bundle without a second GIS implementation.
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const json=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const manifest=await json('published/manifest.json');
const record=await json(manifest.run_record),report=await json('validation/latest-report.json');
const verification=await json(manifest.verification);
assert.equal(report.run_id,record.run_id,'Publication must use the latest canonical run');
assert.equal(verification.status,'passed','Independent verification must pass');
assert.equal(verification.counts.failed,0);
const files=[['published/index.html','index.html'],['findings.md','findings.md']];
for(const item of record.outputs){
 if(item.path.startsWith('dist/documents/'))files.push([item.path.replace('dist/documents/','data/source/'),item.path.slice(5)]);
 if(item.path.startsWith('dist/data/')&&item.path.endsWith('.geojson'))files.push([item.path.replace('dist/data/','data/derived/'),item.path.slice(5)]);
}
const destination=path.resolve(process.argv[2]||'_site/detailplaneering');
for(const [source,target] of files){
 const expected=record.outputs.find(f=>f.path==='dist/'+target);
 const bytes=await readFile(path.join(root,source));
 assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),expected?.sha256,`Unverified publication file: ${source}`);
 await mkdir(path.dirname(path.join(destination,target)),{recursive:true});
 await copyFile(path.join(root,source),path.join(destination,target));
}
console.log(`Prepared ${files.length} verified files from ${record.run_id} at ${destination}`);
// The accepted analytical bundle stays byte-identical in published/. Record the
// optional telemetry delivery transform separately instead of changing its pins.
const original=await readFile(path.join(destination,'index.html'),'utf8');
const release=process.env.GITHUB_SHA||'local-build';
assert.match(release,/^[a-zA-Z0-9-]+$/);
const served=original.replace('</head>',`<script defer src="./analytics.js" data-site="detailplaneering" data-release="${release}"></script></head>`);
assert.notEqual(served,original,'Published HTML must have a head closing tag');
await copyFile(path.join(root,'../shared/analytics.js'),path.join(destination,'analytics.js'));
await writeFile(path.join(destination,'index.html'),served);
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
await writeFile(path.join(destination,'delivery-transform.json'),JSON.stringify({
  schema:'openmapstack-delivery-transform/v1',canonicalRun:record.run_id,
  transformation:'Add optional production-only PostHog script; analytical data unchanged',
  sourceHtmlSha256:hash(original),servedHtmlSha256:hash(served),
  analyticsSha256:hash(await readFile(path.join(destination,'analytics.js'))),
},null,2)+'\n');
