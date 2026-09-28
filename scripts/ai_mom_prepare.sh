#!/usr/bin/env bash
# 아이맘: 비파괴 프로젝트 점검 및 개발용 설정안 생성.
# 앱 설치/개편/배포 스크립트가 아닙니다. 네트워크·Secrets 접근 없음.
set -euo pipefail
task_mode="${1:-inspect}"
case "$task_mode" in
  inspect|prepare) ;;
  *) echo '사용법: bash ai_mom_prepare.sh inspect|prepare' >&2; exit 2 ;;
esac
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js가 필요합니다. 기존 Replit 프로젝트의 Shell에서 실행하세요.' >&2
  exit 1
fi
if [ ! -f package.json ]; then
  echo 'package.json이 없습니다. 프로젝트 최상위 폴더에서 실행하세요.' >&2
  exit 1
fi
node - "$task_mode" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const mode = process.argv[2];
const skip = new Set(['node_modules','dist','build','coverage','vendor','attached_assets','uploads','logs','tmp']);
const allowed = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.css','.scss','.html','.sql','.prisma']);
const manifests = [];
const paths = [];
const warnings = [];
let visited = 0;
function walk(dir, depth = 0) {
  if (depth > 7) { warnings.push(`탐색 깊이 제한: ${dir}`); return; }
  let entries;
  try { entries = fs.readdirSync(dir, {withFileTypes:true}); }
  catch { warnings.push(`읽을 수 없는 경로: ${dir}`); return; }
  for (const e of entries) {
    if (++visited > 15000) throw new Error('파일 수가 너무 많습니다. 출력 없이 중단합니다.');
    if (e.name.startsWith('.') || skip.has(e.name) || e.name.startsWith('ai-mom-prep-')) continue;
    const p = path.join(dir,e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { walk(p,depth+1); continue; }
    if (!e.isFile()) continue;
    // 이름만 기록합니다. 소스 본문은 읽지 않습니다.
    if (allowed.has(path.extname(e.name))) paths.push(p);
    if (e.name === 'package.json') {
      if (fs.statSync(p).size > 1024*1024) { warnings.push(`큰 manifest 제외: ${p}`); continue; }
      try {
        const pkg = JSON.parse(fs.readFileSync(p,'utf8'));
        manifests.push({file:p,name:typeof pkg.name==='string'?pkg.name:null,
          command_names:Object.keys(pkg.scripts||{}),
          dependency_names:Object.keys(pkg.dependencies||{}),
          dev_dependency_names:Object.keys(pkg.devDependencies||{})});
      } catch { warnings.push(`manifest 파싱 실패: ${p}`); }
    }
  }
}
try { walk('.'); } catch(e) { console.error(e.message); process.exit(1); }
const out = fs.mkdtempSync(path.join(process.cwd(),'ai-mom-prep-'));
const write = (name,value) => fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
write('report.json',{generated_at:new Date().toISOString(),node:process.version,
  scope:'File paths and manifest metadata only; no source bodies, scripts values, or environment values.',
  manifests,source_paths:paths.sort(),warnings});
if (mode === 'prepare') {
  write('theme.tokens.json',{schema_version:1,kind:'design_blueprint_not_runtime_config',brand:'아이맘 스튜디오',
    colors:{background:'#F6F7F9',surface:'#FFFFFF',text:'#172334',muted:'#586579',border:'#DDE3EB',primary:'#0B766E',science:'#6550A6',current_affairs:'#285FAD',warning:'#9A5700',error:'#B42318'},
    sizes:{sidebar_px:224,page_title_px:28,body_px:16,secondary_px:14,mobile_touch_min_px:44},
    spacing_px:[4,8,12,16,24,32]});
  const rule=(query,endpoint='news')=>({query,endpoint,enabled:true,display:10,exclude_terms:[]});
  write('channels.blueprint.json',{schema_version:1,kind:'development_blueprint_requires_explicit_import',
    timezone:'Asia/Seoul',auto_collect_enabled:false,auto_generate_enabled:false,auto_publish_enabled:false,
    channels:[
      {slug:'opportunities',name:'아이맘 | 도전·진학',type:'notice',color:'#0B766E',audience:'중학생과 부모',
        seed_search_rules:[rule('하나고 입학설명회'),rule('경기과학고 모집요강'),rule('KAIST 청소년 캠프'),rule('청소년 영재교육원 모집','blog')],
        required_fields:['title','organization','audience','schedule','source_evidence'],
        review_gates:['official_evidence','schedule_validity','human_review']},
      {slug:'science-dialogue',name:'아이맘 | 하루 과학 대화',type:'science_dialogue',color:'#6550A6',audience:'중학생과 부모',
        seed_search_rules:[],evergreen_topic_ideas:['도시의 나무는 어디에 먼저 심어야 할까?','같은 힘으로 밀었는데 왜 움직임이 다를까?'],
        required_fields:['question','background','discussion_questions','evidence','misconceptions','parent_notes','sources'],
        review_gates:['scientific_accuracy','age_fit','human_review']},
      {slug:'current-dialogue',name:'아이맘 | 하루 시사 대화',type:'current_dialogue',color:'#285FAD',audience:'중학생과 부모',
        seed_search_rules:[],editorial_topic_ideas:['학교의 스마트폰 사용 규칙','공공도서관 예산 우선순위'],
        required_fields:['title','event_at','checked_at','verified_facts','perspectives','discussion_questions','sources'],
        review_gates:['freshness','source_independence','facts_vs_opinions','age_fit','human_review']}
    ]});
}
console.log(`완료: ${out}`);
console.log('report.json을 확인한 뒤 이 대화에 첨부하세요.');
if(mode==='prepare') console.log('설정안 2개도 생성했습니다. 앱에는 아직 적용되지 않았습니다.');
console.log('기존 프로젝트 파일과 DB는 변경하지 않았습니다.');
NODE
