import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type opentype from 'opentype.js';

const probes=[
  '한글 AI · 생각의 기준 2026', '가나다라마바사아자차카타파하 힣',
  '각 한글 ㄱㄲㄳㅏㅑㅓ', 'fi ffi ffl office efficient AV To',
  'é e\u0301 Å A\u030a café naïve Straße', 'αβγ ΔΩ Ελληνικά ЖЮЯ русский',
  '日本語 ひらがな カタカナ 漢字 韓國', '中文 简体 繁體 國際',
  '∑ ∫ ∞ ± ≤ ≥ ½ ¼ ① ② → ↔ ★ ♥', '“질문” ‘대화’ … — – • ‧',
  'العربية سلام ไทย ภาษาไทย', '𠀀 𠮷 ❤️ ✈️ ☀︎',
  ' a  b\tc\nd ', '', 'A', '가',
];
export function fontCases(family:string,weight:number):string[]{
  const root=path.resolve('assets/cardnews14/layouts'),text=new Set(probes);
  if(family.startsWith('Noto'))for(const folder of fs.readdirSync(root)){
    const source=JSON.parse(fs.readFileSync(path.join(root,folder,'layout.json'),'utf8'));
    for(const page of source.pages)for(const element of page.elements){
      if(element.kind!=='text'||element.fontFamily!==family)continue;
      const actual=family==='Noto Sans KR'?(element.fontWeight>=600?700:400):element.fontWeight;
      if(actual===weight)text.add(element.copy);
    }
  }
  return [...text];
}
/** Hash exact glyph indexes, advances and outline commands, including the
 * two option paths used by wrapping and drawing. No decimal formatter/shrink. */
export function fontResultDigest(font:opentype.Font,texts:string[]):string{
  const hash=createHash('sha256');
  for(const text of texts){
    hash.update(JSON.stringify(font.stringToGlyphs(text).map(glyph=>glyph.index)));
    for(const size of [32,88]){
      hash.update(JSON.stringify(font.getAdvanceWidth(text,size,{kerning:true})));
      hash.update(JSON.stringify(font.getPath(text,72,220,size,{kerning:true,letterSpacing:-.02}).commands));
    }
  }
  return hash.digest('hex');
}
