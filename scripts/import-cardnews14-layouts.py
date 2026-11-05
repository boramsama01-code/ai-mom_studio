import json,pathlib,hashlib,math,shutil,sys
r=pathlib.Path(sys.argv[1])
out=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((r/'assets/manifest.json').read_text()); images=manifest['images']
print('asset count',len(images),'keys',[v['key'] for v in images])
styles=[]
for f in sorted((r/'templates').glob('*/layout.json')):
 raw=f.read_bytes(); l=json.loads(raw);assetkeys=sorted(set(e['asset'] for p in l['pages'] for e in p['elements'] if e['kind']=='image'))
 used=[{k:v[k] for k in ('key','path','sha256')} for v in images if v['key'] in assetkeys]
 assert len(used)==len(assetkeys),(assetkeys,used)
 dest=out/'assets/cardnews14/layouts'/f.parent.name/'layout.json';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
 pages=[]
 for p in l['pages']:
  elements=[]
  for e in p['elements']:
   e={k:v for k,v in e.items() if k not in ('copy','unwrappedCopy','asset') and v is not None}
   if e['kind']=='text':
    e['maxLines']=max(1,math.floor((e['height']+.01)/(e['fontSize']*e['lineHeight'])))
    e['effectiveFontWeight']=(700 if e['fontWeight']>=600 else 400) if e['fontFamily']=='Noto Sans KR' else e['fontWeight']
   elif e['kind']=='image':
    source=next(x for x in p['elements'] if x.get('field')==e['field'])
    e['treatment']={'tone':'monochrome' if source['asset']=='B' else 'color'}
   elements.append(e)
  pages.append({'page':p['page'],'background':p['background'],'elements':elements})
 styles.append({'id':l['id'],'name':l['name'],'sourceVersion':l['version'],'sourceLayoutPath':str(dest.relative_to(out)),'sourceLayoutSha256':hashlib.sha256(raw).hexdigest(),'sourceAssetsSha256':hashlib.sha256(json.dumps(used,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'sourceAssets':used,'pages':pages})
(out/'shared/cardnews14Layout.json').write_text(json.dumps({'schemaVersion':1,'styles':styles},ensure_ascii=False,separators=(',',':'))+'\n')
# Reference contract is kept separate from runtime data. Example photos are for offline QA only.
d=out/'assets/cardnews14';d.mkdir(parents=True,exist_ok=True)
for name in ('manifest.json','cinematic-ink-teal-background.jpg','monochrome-editorial-background.jpg','amber-cream-editorial-background.jpg'):
 shutil.copyfile(r/'assets'/name,d/name)
logo=out/'assets/branding/allligodang-bw.png';logo.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(r/'assets/allligodang-bw-profile.png',logo)
for name in ('common-copy.example.json','text-fields.json','native-font-compatibility.json'):
 shutil.copyfile(r/'contracts'/name,d/name)
print('generated',len(styles),'profiles',sum(len(p['elements']) for s in styles for p in s['pages']),'elements; runtime bytes',(out/'shared/cardnews14Layout.json').stat().st_size)
