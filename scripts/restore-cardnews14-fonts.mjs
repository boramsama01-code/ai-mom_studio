// Offline, integrity-checked reconstruction of unmodified OFL fonts. Keep each
// GitHub transfer unit small; never download a font while serving a request.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/fonts/cardnews14');
const manifest=JSON.parse(await readFile(resolve(root,'packed/manifest.json'),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
if(manifest.version!==1||manifest.encoding!=='gzip'||manifest.files.length!==2)throw new Error('Invalid cardnews14 font manifest');
for(const entry of manifest.files){
  if(!/^Noto(?:Sans|Serif)KR-Variable\.ttf$/.test(entry.file)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>30_000_000)throw new Error('Invalid cardnews14 font entry');
  const target=resolve(root,entry.file);
  const existing=await readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing?.length===entry.bytes&&sha256(existing)===entry.sha256)continue;
  const prefix=entry.file.replace(/\.ttf$/,'');
  const packed=Buffer.concat(await Promise.all(entry.parts.map((part,index)=>{
    if(part!==`${prefix}.${String(index).padStart(3,'0')}.part`)throw new Error('Invalid cardnews14 font part');
    return readFile(resolve(root,'packed',part));
  })));
  if(packed.length!==entry.packedBytes||sha256(packed)!==entry.packedSha256)throw new Error(`Cardnews14 font archive integrity check failed: ${entry.file}`);
  const bytes=gunzipSync(packed,{maxOutputLength:entry.bytes+1});
  if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new Error(`Cardnews14 font integrity check failed: ${entry.file}`);
  await writeFile(target,bytes);
}
console.log('Cardnews14 OFL fonts restored and verified.');
