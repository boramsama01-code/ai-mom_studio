/** Narrow allocation-only patch for opentype.js 2.0.0 (MIT).
 * Upstream: https://github.com/opentypejs/opentype.js
 * Copyright and full license: docs/third-party/opentype-MIT.txt.
 * Do not disable ccmp, change a glyph, return a sparse array or alter ordering.
 * Unknown package/source revisions fail closed instead of applying blindly. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceHashes={
  'opentype.js':{original:'737212d8aae53d1996ef10b315e4369a1542ebb9b94c13c5f99793914745d484',patched:'d447f3a7112bb399657aec868610f024de9981a08d6cbee81497081c9ba7bf17'},
  'opentype.mjs':{original:'e139522ac432bb38fb4878d772012f0ad351993c36d7815d65a9890fb3fe68fb',patched:'3ed4c1d72e0448598291c760c01fd2df4f1115f4ef3bb0b20049d3d9e650bc72'},
};
const digest=value=>createHash('sha256').update(value).digest('hex');

function changeFunction(source,start,end,change){
  const first=source.indexOf(start),last=source.indexOf(end,first);
  if(first<0||last<0)throw new Error('OpenType allocation patch: expected function missing');
  const indent=source.slice(source.lastIndexOf('\n',first)+1,first);
  if(!/^ *$/.test(indent))throw new Error('OpenType allocation patch: unexpected function indentation');
  const body=source.slice(first,last).split('\n').map((line,index)=>index&&line.startsWith(indent)?line.slice(indent.length):line).join('\n');
  const changed=change(body).split('\n').map((line,index)=>index?indent+line:line).join('\n');
  return source.slice(0,first)+changed+source.slice(last);
}
function transform(source){
  source=changeFunction(source,'function chainingSubstitutionFormat3(contextParams, subtable)','function ligatureSubstitutionFormat1',body=>body
    .replace('  let lookaheadContext = contextParams.lookahead.slice(lookaheadOffset);','  let lookaheadLookups = [];\n  if (subtable.lookaheadCoverage.length) {\n  let lookaheadContext = contextParams.lookahead.slice(lookaheadOffset);')
    .replace('  let lookaheadLookups = lookupCoverageList(','  lookaheadLookups = lookupCoverageList(')
    .replace('  let backtrackContext = [].concat(contextParams.backtrack);','  }\n  if (lookaheadLookups === -1) return [];\n  let backtrackLookups = [];\n  if (subtable.backtrackCoverage.length) {\n  let backtrackContext = [].concat(contextParams.backtrack);')
    .replace('  let backtrackLookups = lookupCoverageList(','  backtrackLookups = lookupCoverageList(')
    .replace('  const contextRulesMatch =','  }\n  const contextRulesMatch ='));
  source=changeFunction(source,'FeatureQuery.prototype.lookupFeature = function','FeatureQuery.prototype.supports',body=>body
    .replace('  const substitutions = [].concat(contextParams.context);','  const originalContext = contextParams.context;\n  let substitutions = originalContext;')
    .replace('      let substitution;\n','      let substitution;\n      const previousSubstitution = substitutions[currentIndex];\n')
    .replaceAll('            substitutions.splice(currentIndex, 1, new SubstitutionAction({','            if (substitutions === originalContext) substitutions = originalContext.slice();\n            substitutions.splice(currentIndex, 1, new SubstitutionAction({')
    .replace('      contextParams = new ContextParams(substitutions, currentIndex);','      if (substitutions[currentIndex] !== previousSubstitution) contextParams = new ContextParams(substitutions, currentIndex);'));
  return changeFunction(source,'function ccmpReplacementLigatures(range)','var ccmpReplacementLigatures_default',body=>body
    .replace('    if (substitutions.length) {\n      for','    if (substitutions.length) {\n      let changed = false;\n      for')
    .replace('        const action = substitutions[i];\n        applySubstitution_default','        const action = substitutions[i];\n        if (action instanceof SubstitutionAction) changed = true;\n        applySubstitution_default')
    .replace('      contextParams = getContextParams2(tokens);','      if (changed) contextParams = getContextParams2(tokens);'));
}

export async function patchOpenTypeMemory(packageDirectory){
  const require=createRequire(import.meta.url);
  const root=packageDirectory??resolve(dirname(require.resolve('opentype.js')),'..');
  const metadata=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
  if(metadata.name!=='opentype.js'||metadata.version!=='2.0.0')throw new Error('OpenType allocation patch requires the reviewed opentype.js 2.0.0. Review a new version before upgrading.');
  const pending=[];
  for(const [name,hashes] of Object.entries(sourceHashes)){
    const file=resolve(root,'dist',name),source=await readFile(file,'utf8'),sha=digest(source);
    if(sha===hashes.patched)continue;
    if(sha!==hashes.original)throw new Error(`OpenType allocation patch: unrecognized source SHA for ${name}`);
    const patched=transform(source);
    if(digest(patched)!==hashes.patched)throw new Error(`OpenType allocation patch: output SHA mismatch for ${name}`);
    pending.push({file,patched});
  }
  // Verify every file before writing either entry point.
  for(const {file,patched} of pending)await writeFile(file,patched);
  return {version:metadata.version,changed:pending.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await patchOpenTypeMemory();
  console.log(`OpenType ${result.version} allocation patch verified (${result.changed} files changed).`);
}
