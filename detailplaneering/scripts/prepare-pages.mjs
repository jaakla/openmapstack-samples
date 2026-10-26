// Publish the verified canonical bundle without a second GIS implementation.
import {readFile, mkdir, copyFile} from 'node:fs/promises';
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
