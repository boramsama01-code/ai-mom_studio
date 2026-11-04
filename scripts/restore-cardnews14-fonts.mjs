// Offline reconstruction of full-Unicode static weights from bundled OFL
// sources. The original variable archives remain as reproducible provenance;
// serving requests never loads them or downloads a font.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/fonts/cardnews14');
// Only an explicit build-time command restores the preserved variable source.
const sources=process.argv.includes('--sources');
const archiveDirectory=sources?'packed':'packed-static';
const manifest=JSON.parse(await readFile(resolve(root,archiveDirectory,'manifest.json'),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
if(manifest.version!==1||manifest.encoding!=='gzip'||manifest.files.length!==(sources?2:7))throw new Error('Invalid cardnews14 font manifest');
await mkdir(resolve(root,'generated'),{recursive:true});
for(const entry of manifest.files){
  const validName=sources?/^Noto(?:Sans|Serif)KR-Variable\.ttf$/.test(entry.file):/^generated\/Noto(?:Sans|Serif)KR-[4-9]00\.ttf$/.test(entry.file);
  if(!validName||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>30_000_000)throw new Error('Invalid cardnews14 font entry');
  const target=resolve(root,entry.file);
  const existing=await readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing?.length===entry.bytes&&sha256(existing)===entry.sha256)continue;
  const prefix=entry.file.replace(/^generated\//,'').replace(/\.ttf$/,'');
  const packed=Buffer.concat(await Promise.all(entry.parts.map((part,index)=>{
    if(part!==`${prefix}.${String(index).padStart(3,'0')}.part`)throw new Error('Invalid cardnews14 font part');
    return readFile(resolve(root,archiveDirectory,part));
  })));
  if(packed.length!==entry.packedBytes||sha256(packed)!==entry.packedSha256)throw new Error(`Cardnews14 font archive integrity check failed: ${entry.file}`);
  const bytes=gunzipSync(packed,{maxOutputLength:entry.bytes+1});
  if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new Error(`Cardnews14 font integrity check failed: ${entry.file}`);
  await writeFile(target,bytes);
}
console.log('Cardnews14 OFL fonts restored and verified.');
