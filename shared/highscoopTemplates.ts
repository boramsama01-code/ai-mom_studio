/** One current, editable Canva master per HighScoop category.
 * The same catalogue is used by Studio's picker and native Canva export.
 * Canva layout changes remain manual; these links never imply reverse layout sync.
 */
export const HIGH_SCOOP_TEMPLATE_VERSION='2026-11-13' as const;
export const HIGH_SCOOP_LAYOUT_LABELS=['사진·문서 표지','텍스트·형광펜','2단 비교','사진 + 글','표','단계도','기간표','막대그래프','문서 캡처','메신저 대화','팔로우 마무리'] as const;
export type HighScoopTemplateKit={key:string;category:string;label:string;color:string;soft:string;accent:string;canvaDesignId:string|null;canvaEditUrl:string|null;thumbnailUrl:string;overviewUrl:string;pageCount:11;layoutLabels:typeof HIGH_SCOOP_LAYOUT_LABELS};
const CANVA_MASTERS:Record<string,{id:string;url:string}>={
 gifted:{id:'DAHaw_M5LAQ',url:'https://www.canva.com/d/UFF06tfKKjwcOyG'},
 experience:{id:'DAHaw25FHwE',url:'https://www.canva.com/d/2x0G3kRkJscexBo'},
 competition:{id:'DAHaw2tBgxE',url:'https://www.canva.com/d/dSDlsiuSKiTHbfm'},
 admissions:{id:'DAHaw3m90CI',url:'https://www.canva.com/d/5fCg-9tJpecZ_Ul'},
 conversation:{id:'DAHawwtZJkE',url:'https://www.canva.com/d/3d_3TbMlFfaryb0'},
 news:{id:'DAHawxSGlDg',url:'https://www.canva.com/d/G6r_UKxQA_FnHZF'},
};
const make=(slug:string,category:string,color:string,soft:string,accent:string):HighScoopTemplateKit=>({key:`highscoop:${slug}`,category,label:category,color,soft,accent,canvaDesignId:CANVA_MASTERS[slug]?.id??null,canvaEditUrl:CANVA_MASTERS[slug]?.url??null,thumbnailUrl:`/highscoop/current/${slug}-cover.webp`,overviewUrl:`/highscoop/current/${slug}-overview.webp`,pageCount:11,layoutLabels:HIGH_SCOOP_LAYOUT_LABELS});
export const HIGH_SCOOP_TEMPLATE_KITS:readonly HighScoopTemplateKit[]=[
 make('gifted','영재원','#FF493B','#FFF2F0','#A42C24'),
 make('experience','체험','#5ED7B5','#EDF9F5','#116E55'),
 make('competition','대회','#BAA0FF','#F5F0FF','#5C3699'),
 make('admissions','입시','#72A7FF','#F2F7FF','#245B9F'),
 make('conversation','말풍선','#FFD166','#FFF9E9','#795A10'),
 make('news','뉴스','#57C7E3','#ECFAFD','#14697E'),
];
export function highScoopTemplateForKey(key:string|undefined|null):HighScoopTemplateKit|undefined{return HIGH_SCOOP_TEMPLATE_KITS.find(kit=>kit.key===key);}
export function highScoopTemplateForCategory(category:string|undefined|null):HighScoopTemplateKit|undefined{return HIGH_SCOOP_TEMPLATE_KITS.find(kit=>kit.category===category);}
export function isHighScoopChannel(channel:{slug?:string;name?:string}):boolean{
 return ['opportunities','highscoop','highway'].includes(channel.slug??'')||/^(?:Highscoop|하이스쿱|하이웨이)(?:\s*[·|:]|\s*$)/i.test(channel.name?.trim()??'');
}
