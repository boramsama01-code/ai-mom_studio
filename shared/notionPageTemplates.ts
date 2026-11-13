/** Persisted legacy IDs remain readable; new manuscripts use this current kit. */
export const notionInteriorTemplates = ['text','two_columns','image_text','table','process','timeline','bar_chart','document_excerpt','dialogue'] as const;
export type NotionInteriorTemplate = typeof notionInteriorTemplates[number];
export const notionInteriorTemplateCatalog: ReadonlyArray<{id:NotionInteriorTemplate;label:string;description:string}> = [
  {id:'text',label:'텍스트',description:'제목과 본문을 넓게 배치'},
  {id:'two_columns',label:'2단 텍스트',description:'두 내용을 나란히 비교'},
  {id:'image_text',label:'사진 + 글',description:'사진 한 장과 설명'},
  {id:'table',label:'표',description:'항목과 내용을 행·열로 정리'},
  {id:'process',label:'단계도',description:'순서와 단계별 설명'},
  {id:'timeline',label:'기간표',description:'시작일·마감일을 막대로 표시'},
  {id:'bar_chart',label:'막대그래프',description:'항목별 수치를 비교'},
  {id:'document_excerpt',label:'문서 캡처',description:'PDF 부분 캡처를 크게 배치하고 투명 표시 PNG를 별도 레이어로 겹치기'},
  {id:'dialogue',label:'메신저 대화',description:'화자별 말풍선으로 대화하기 · 사진을 고르면 사진과 대화를 나란히 배치'},
];
