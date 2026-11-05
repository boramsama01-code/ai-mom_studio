import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import opentype from 'opentype.js';
import baseline from './fixtures/cardnews14-font-glyph-baseline.json';
import {fontCases,fontResultDigest} from './fixtures/cardnews14FontCases';

const require=createRequire(import.meta.url),dist=path.dirname(require.resolve('opentype.js'));
const esm=await import(pathToFileURL(path.join(dist,'opentype.mjs')).href) as {parse:typeof opentype.parse};

describe('reviewed OpenType allocation patch preserves actual font shaping',()=>{
  for(const check of baseline.checks)it(`${check.family} ${check.weight}: CJS and ESM match the unmodified upstream glyph/advance/path baseline`,()=>{
    const bytes=fs.readFileSync(check.file),texts=fontCases(check.family,check.weight);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(check.fontSha256);
    expect(texts).toHaveLength(check.cases);
    for(const parse of [opentype.parse,esm.parse]){
      const font=parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{lowMemory:true});
      expect(fontResultDigest(font,texts)).toBe(check.upstreamResultSha256);
    }
  });

  it('is idempotent and refuses a new package version or modified source before any write',async()=>{
    const {patchOpenTypeMemory}=await import(pathToFileURL(path.resolve('scripts/patch-opentype-memory.mjs')).href) as {patchOpenTypeMemory:(directory:string)=>Promise<{changed:number}>};
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'opentype-integrity-'));
    try{
      fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'opentype.js',version:'2.0.0'}));
      for(const file of ['opentype.js','opentype.mjs'])fs.copyFileSync(path.join(dist,file),path.join(root,'dist',file));
      expect(await patchOpenTypeMemory(root)).toMatchObject({changed:0});
      const before=fs.readFileSync(path.join(root,'dist/opentype.js'));
      fs.appendFileSync(path.join(root,'dist/opentype.mjs'),'\n// unreviewed change\n');
      await expect(patchOpenTypeMemory(root)).rejects.toThrow('unrecognized source SHA');
      expect(fs.readFileSync(path.join(root,'dist/opentype.js'))).toEqual(before);
      fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'opentype.js',version:'2.0.1'}));
      await expect(patchOpenTypeMemory(root)).rejects.toThrow('requires the reviewed opentype.js 2.0.0');
      expect(fs.readFileSync(path.join(root,'dist/opentype.js'))).toEqual(before);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
