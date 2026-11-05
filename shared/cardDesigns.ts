/** Original paired cover/body systems. Template IDs are stable persisted values. */
export type CardDesign = {
  id: string; name: string; family: "recruitment" | "news" | "food"; description: string;
  bg: string; ink: string; accent: string; soft: string; onAccent: string;
  body: "plain" | "panels" | "timeline" | "notes" | "ledger" | "split" | "framed" | "bands" | "spotlight" | "index";
  art: "lab" | "rocket" | "city" | "globe" | "fries";
  layoutId?: string; colorName?: string; overlay?: string; onSoft?: string;
};
/** All completed cover/body sets retain their original persisted identity. */
export const PERSISTED_CARD_DESIGNS: CardDesign[] = [
  { id: "r01", name: "캠퍼스 에디토리얼", family: "recruitment", description: "사진과 여백으로 여는 차분한 모집 안내", bg: "#F4F1E9", ink: "#163B35", accent: "#176752", soft: "#E3E9DC", onAccent: "#FFFFFF", body: "plain", art: "lab" },
  { id: "r02", name: "오픈콜", family: "recruitment", description: "큰 글자와 코발트 블루의 선명한 공고", bg: "#2447E8", ink: "#FFFFFF", accent: "#E4FF83", soft: "#3557EF", onAccent: "#173224", body: "bands", art: "rocket" },
  { id: "r03", name: "보딩패스", family: "recruitment", description: "티켓에서 시작해 일정표로 이어지는 구성", bg: "#F2EDE3", ink: "#252D36", accent: "#BA3F2C", soft: "#E9DFD1", onAccent: "#FFFFFF", body: "ledger", art: "rocket" },
  { id: "r04", name: "랩 노트", family: "recruitment", description: "모눈과 번호로 정리하는 탐구·교육 모집", bg: "#EDF2E8", ink: "#233D2F", accent: "#316246", soft: "#DCE6D5", onAccent: "#FFFFFF", body: "notes", art: "lab" },
  { id: "r05", name: "넥스트 오빗", family: "recruitment", description: "화면을 채운 사진 위로 제목이 놓이는 모집 포스터", bg: "#101F31", ink: "#F0F4F5", accent: "#B6F4D5", soft: "#1B3046", onAccent: "#102A23", body: "panels", art: "globe" },
  { id: "r06", name: "페이퍼 플레이", family: "recruitment", description: "종이 질감의 그림과 편안한 안내 카드", bg: "#F7EFD9", ink: "#303F70", accent: "#A13B2C", soft: "#EDE0BF", onAccent: "#FFFFFF", body: "spotlight", art: "rocket" },
  { id: "r07", name: "아카데미 초대장", family: "recruitment", description: "정갈한 프레임과 중앙 정렬의 공식 초대", bg: "#F8F2E9", ink: "#562733", accent: "#7D3545", soft: "#EEE2DA", onAccent: "#FFFFFF", body: "framed", art: "lab" },
  { id: "r08", name: "라임 인덱스", family: "recruitment", description: "라임색 정보 블록으로 읽는 프로그램 안내", bg: "#DBF57C", ink: "#1F2922", accent: "#29382B", soft: "#C8E368", onAccent: "#EDFFB5", body: "split", art: "rocket" },
  { id: "r09", name: "스텝업", family: "recruitment", description: "세로 흐름과 단계 번호로 이끄는 신청 안내", bg: "#FAF4E9", ink: "#3A342E", accent: "#B0441F", soft: "#F2DFCC", onAccent: "#FFFFFF", body: "timeline", art: "lab" },
  { id: "r10", name: "콰이어트 포스터", family: "recruitment", description: "작은 사진과 넓은 여백의 담백한 안내", bg: "#FAFBFC", ink: "#1C3558", accent: "#2857A5", soft: "#EDF1F7", onAccent: "#FFFFFF", body: "index", art: "lab" },
  { id: "n01", name: "레드 플래시", family: "news", description: "사진 위 큰 헤드라인과 빨간 속보 띠", bg: "#171C23", ink: "#FFFFFF", accent: "#DE342D", soft: "#282E38", onAccent: "#FFFFFF", body: "bands", art: "city" },
  { id: "n02", name: "데일리 페이퍼", family: "news", description: "신문의 제호·구분선·정보 위계를 담은 브리핑", bg: "#F5F0E5", ink: "#252B2F", accent: "#942C2C", soft: "#EAE3D5", onAccent: "#FFFFFF", body: "ledger", art: "city" },
  { id: "n03", name: "포토 디스패치", family: "news", description: "사진과 헤드라인을 분리한 현장형 뉴스", bg: "#F8FAFB", ink: "#1D2D3C", accent: "#236386", soft: "#E8EEF2", onAccent: "#FFFFFF", body: "plain", art: "city" },
  { id: "n04", name: "알리고당 브리프", family: "news", description: "세 가지 색과 큰 글자로 핵심을 짚는 뉴스", bg: "#F7E768", ink: "#263D69", accent: "#263D69", soft: "#F09A7D", onAccent: "#FFF8CD", onSoft: "#263D69", body: "spotlight", art: "globe" },
  { id: "n05", name: "시그널 데스크", family: "news", description: "짙은 남색과 청록의 또렷한 업데이트", bg: "#102A3C", ink: "#ECF5F7", accent: "#83E5E3", soft: "#1C3A4D", onAccent: "#12303C", body: "panels", art: "globe" },
  { id: "n06", name: "뉴스 타임라인", family: "news", description: "사건의 순서와 확인할 내용을 차례로 정리", bg: "#F0F5FC", ink: "#17385C", accent: "#2459A8", soft: "#DDE8F8", onAccent: "#FFFFFF", body: "timeline", art: "city" },
  { id: "n07", name: "한 문장 브리핑", family: "news", description: "핵심 문장을 크게 보여 주는 해설형 카드", bg: "#194C49", ink: "#F8F3E6", accent: "#F0D3A0", soft: "#275D58", onAccent: "#1D423D", body: "framed", art: "globe" },
  { id: "n08", name: "팩트 인덱스", family: "news", description: "확인된 정보와 미확인 내용을 구분하는 구성", bg: "#E8EFFC", ink: "#172F66", accent: "#224EB0", soft: "#D6E1F5", onAccent: "#FFFFFF", body: "index", art: "globe" },
  { id: "n09", name: "두 가지 시선", family: "news", description: "분할 화면으로 관점과 질문을 나란히 배치", bg: "#F5E8E3", ink: "#253749", accent: "#2C5275", soft: "#E5D2C9", onAccent: "#FFFFFF", body: "split", art: "city" },
  { id: "n10", name: "미니멀 업데이트", family: "news", description: "작은 업데이트 표시와 큰 제목에 집중", bg: "#FAF8F3", ink: "#22262B", accent: "#AA342B", soft: "#EEEBE3", onAccent: "#FFFFFF", body: "notes", art: "city" },
  { id: "f01", name: "Fryday · 크리스프", family: "food", description: "전체 배경 이미지와 큰 제목, 네 장의 지식·비교 카드", bg: "#2C201B", ink: "#FFF5E0", accent: "#F9CB45", soft: "#453329", onAccent: "#2C201B", body: "panels", art: "fries" },
];
export const CARD_DESIGNS = PERSISTED_CARD_DESIGNS;
const COLOR_DESIGN_IDS = ["r01", "r05", "n01", "n03", "n04", "f01"];
type Palette = Pick<CardDesign, "bg" | "ink" | "accent" | "soft" | "onAccent" | "overlay" | "onSoft"> & { suffix: string; name: string };
const palette = (suffix: string, name: string, bg: string, ink: string, accent: string, soft: string, onAccent: string, overlay?: string, onSoft?: string): Palette => ({ suffix, name, bg, ink, accent, soft, onAccent, onSoft, ...(overlay ? { overlay } : {}) });
const ORIGINAL_NAMES: Record<string, string> = { f01: "브라운", r01: "아이보리", r05: "미드나이트", n01: "시그널 레드", n03: "페이퍼", n04: "레몬" };
const PALETTES: Record<string, Palette[]> = {
  f01: [palette("cream", "크림", "#FFF5E0", "#2C201B", "#58351E", "#F8E4AE", "#FFF5E0"), palette("olive", "올리브", "#26372D", "#FFF5E0", "#F9CB45", "#3A4D3F", "#26372D")],
  r01: [
    palette("blue", "페이퍼 블루", "#F0F5FC", "#203853", "#2457A6", "#DDE8F6", "#FFFFFF"),
    palette("sage", "세이지", "#EEF3E8", "#243D31", "#396448", "#DDE7D3", "#FFFFFF"),
    palette("butter", "버터", "#FFF5D8", "#4B3922", "#7B531E", "#F1E4B8", "#FFFFFF"),
    palette("rose", "로즈 클레이", "#FAEEEA", "#56352F", "#993F35", "#EFDBD4", "#FFFFFF"),
    palette("mono", "쿨 화이트", "#F9FAFB", "#202B36", "#394B60", "#E9EDF1", "#FFFFFF"),
  ],
  r05: [
    palette("blue", "딥 블루", "#081B3A", "#F2F6FF", "#A8CBFF", "#16345B", "#152B45"),
    palette("amber", "앰버", "#211C17", "#FFF8EB", "#F5C775", "#392E22", "#3B2912"),
    palette("forest", "포레스트", "#102E29", "#F1F9F0", "#C5EB7B", "#214239", "#233511"),
    palette("wine", "버건디", "#321E28", "#FFF0F1", "#FFB9A6", "#48303D", "#3C2128"),
    palette("cyan", "딥 시안", "#102D35", "#EEFAF8", "#83E6E1", "#2A4348", "#183740"),
  ],
  n01: [
    palette("blue", "일렉트릭 블루", "#101D32", "#FFFFFF", "#2264DC", "#1D304F", "#FFFFFF", "#071B3A"),
    palette("yellow", "시그널 옐로", "#252218", "#FFFFFF", "#FFD96A", "#3B3523", "#202817", "#181609"),
    palette("green", "에메랄드", "#122A22", "#FFFFFF", "#16745C", "#244037", "#FFFFFF", "#05241C"),
    palette("orange", "선셋 오렌지", "#2B211B", "#FFFFFF", "#FF9C5C", "#413125", "#322016", "#2C1307"),
    palette("ice", "아이스 시안", "#122731", "#FFFFFF", "#8EDDEA", "#243E4B", "#112C39", "#061F2A"),
  ],
  n03: [
    palette("sky", "스카이", "#EDF4FE", "#15395B", "#245AA3", "#DCE8F8", "#FFFFFF"),
    palette("mint", "민트", "#EDF6F1", "#28443A", "#246A54", "#DBEBE3", "#FFFFFF"),
    palette("sand", "샌드", "#F5EFE5", "#443B2E", "#8A5A2B", "#E7DDCD", "#FFFFFF"),
    palette("coral", "코랄", "#FCF0EC", "#56352D", "#9D4936", "#F0DED7", "#FFFFFF"),
    palette("dark", "슬레이트", "#182531", "#F3F6F8", "#A8D1F2", "#2A3A47", "#1A3448"),
  ],
  n04: [
    palette("lime", "라임", "#DFF782", "#4C293F", "#4C293F", "#98CDB7", "#EAF8C4", undefined, "#4C293F"),
    palette("ice", "아이스 블루", "#DCEFFB", "#143F40", "#143F40", "#F1A27E", "#ECF8F5", undefined, "#143F40"),
    palette("peach", "피치", "#FFD9C5", "#244A9B", "#244A9B", "#C6DE82", "#FFF3E8", undefined, "#244A9B"),
    palette("cobalt", "코발트", "#2146B9", "#FFFFFF", "#F1C580", "#93C9CC", "#17366C", undefined, "#17366C"),
    palette("charcoal", "차콜", "#252A2B", "#F7F5EB", "#F7E768", "#373E3E", "#292E23"),
  ],
};
export function cardDesignVariants(layoutId: string): CardDesign[] {
  const base = CARD_DESIGNS.find(d => d.id === layoutId);
  if (!base) return [];
  return [{ ...base, layoutId, colorName: ORIGINAL_NAMES[layoutId] ?? "기본" }, ...(PALETTES[layoutId] ?? []).map(({ suffix, name, ...colors }) => ({ ...base, ...colors, id: `${layoutId}-${suffix}`, layoutId, colorName: name }))];
}
// Keep the existing 33 palette identities. The other completed sets expose
// their original colour, rather than inventing new variants for old designs.
export const CARD_COLOR_VARIANTS = CARD_DESIGNS.filter(d => COLOR_DESIGN_IDS.includes(d.id)).flatMap(d => cardDesignVariants(d.id));
export const cardDesign = (id: string) => CARD_COLOR_VARIANTS.find(d => d.id === id) ?? PERSISTED_CARD_DESIGNS.find(d => d.id === id);
export const collectionUsesArt = (id: string) => !["r02", "r07", "n04", "n07", "n08", "n10"].includes(cardDesign(id)?.layoutId ?? id);
export const cardDesignOptions = () => CARD_DESIGNS.map(d => ({ key: `set:${d.id}`, templateKey: `set:${d.id}`, name: d.name, description: d.description, kind: "builtin" as const, family: d.family, setId: d.id,
  format: "standard" as const, cardCopyVersion: 1 as const, pageCount: 5, previewPageCount: 5, pageCountMode: "variable" as const, generation: "legacy" as const,
  colors: cardDesignVariants(d.id).map(v => ({ key: `set:${v.id}`, name: v.colorName!, bg: v.bg, ink: v.ink, accent: v.accent, ...(v.onSoft ? { secondary: v.soft } : {}) })),
}));
