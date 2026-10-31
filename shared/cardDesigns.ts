/** Original paired cover/body systems. Template IDs are stable persisted values. */
export type CardDesign = {
  id: string; name: string; family: "recruitment" | "news"; description: string;
  bg: string; ink: string; accent: string; soft: string; onAccent: string;
  body: "plain" | "panels" | "timeline" | "notes" | "ledger" | "split" | "framed" | "bands" | "spotlight" | "index";
  art: "lab" | "rocket" | "city" | "globe";
};
export const CARD_DESIGNS: CardDesign[] = [
  { id: "r01", name: "캠퍼스 에디토리얼", family: "recruitment", description: "사진과 여백으로 여는 차분한 모집 안내", bg: "#F4F1E9", ink: "#163B35", accent: "#176752", soft: "#E3E9DC", onAccent: "#FFFFFF", body: "plain", art: "lab" },
  { id: "r02", name: "오픈콜", family: "recruitment", description: "큰 글자와 코발트 블루의 선명한 공고", bg: "#2447E8", ink: "#FFFFFF", accent: "#E4FF83", soft: "#3557EF", onAccent: "#173224", body: "bands", art: "rocket" },
  { id: "r03", name: "보딩패스", family: "recruitment", description: "티켓에서 시작해 일정표로 이어지는 구성", bg: "#F2EDE3", ink: "#252D36", accent: "#BA3F2C", soft: "#E9DFD1", onAccent: "#FFFFFF", body: "ledger", art: "rocket" },
  { id: "r04", name: "랩 노트", family: "recruitment", description: "모눈과 번호로 정리하는 탐구·교육 모집", bg: "#EDF2E8", ink: "#233D2F", accent: "#316246", soft: "#DCE6D5", onAccent: "#FFFFFF", body: "notes", art: "lab" },
  { id: "r05", name: "넥스트 오빗", family: "recruitment", description: "우주 이미지와 짙은 배경의 미래형 포스터", bg: "#101F31", ink: "#F0F4F5", accent: "#B6F4D5", soft: "#1B3046", onAccent: "#102A23", body: "panels", art: "globe" },
  { id: "r06", name: "페이퍼 플레이", family: "recruitment", description: "종이 질감의 그림과 편안한 안내 카드", bg: "#F7EFD9", ink: "#303F70", accent: "#A13B2C", soft: "#EDE0BF", onAccent: "#FFFFFF", body: "spotlight", art: "rocket" },
  { id: "r07", name: "아카데미 초대장", family: "recruitment", description: "정갈한 프레임과 중앙 정렬의 공식 초대", bg: "#F8F2E9", ink: "#562733", accent: "#7D3545", soft: "#EEE2DA", onAccent: "#FFFFFF", body: "framed", art: "lab" },
  { id: "r08", name: "라임 인덱스", family: "recruitment", description: "라임색 정보 블록으로 읽는 프로그램 안내", bg: "#DBF57C", ink: "#1F2922", accent: "#29382B", soft: "#C8E368", onAccent: "#EDFFB5", body: "split", art: "rocket" },
  { id: "r09", name: "스텝업", family: "recruitment", description: "세로 흐름과 단계 번호로 이끄는 신청 안내", bg: "#FAF4E9", ink: "#3A342E", accent: "#B0441F", soft: "#F2DFCC", onAccent: "#FFFFFF", body: "timeline", art: "lab" },
  { id: "r10", name: "콰이어트 포스터", family: "recruitment", description: "작은 사진과 넓은 여백의 담백한 안내", bg: "#FAFBFC", ink: "#1C3558", accent: "#2857A5", soft: "#EDF1F7", onAccent: "#FFFFFF", body: "index", art: "lab" },
  { id: "n01", name: "레드 플래시", family: "news", description: "사진 위 큰 헤드라인과 빨간 속보 띠", bg: "#171C23", ink: "#FFFFFF", accent: "#DE342D", soft: "#282E38", onAccent: "#FFFFFF", body: "bands", art: "city" },
  { id: "n02", name: "데일리 페이퍼", family: "news", description: "신문의 제호·구분선·정보 위계를 담은 브리핑", bg: "#F5F0E5", ink: "#252B2F", accent: "#942C2C", soft: "#EAE3D5", onAccent: "#FFFFFF", body: "ledger", art: "city" },
  { id: "n03", name: "포토 디스패치", family: "news", description: "사진과 헤드라인을 분리한 현장형 뉴스", bg: "#F8FAFB", ink: "#1D2D3C", accent: "#236386", soft: "#E8EEF2", onAccent: "#FFFFFF", body: "plain", art: "city" },
  { id: "n04", name: "와이 브리프", family: "news", description: "질문에서 출발해 맥락을 설명하는 뉴스", bg: "#F7E768", ink: "#262A23", accent: "#303A2B", soft: "#EDDC58", onAccent: "#FFF5AC", body: "spotlight", art: "globe" },
  { id: "n05", name: "시그널 데스크", family: "news", description: "짙은 남색과 청록의 또렷한 업데이트", bg: "#102A3C", ink: "#ECF5F7", accent: "#83E5E3", soft: "#1C3A4D", onAccent: "#12303C", body: "panels", art: "globe" },
  { id: "n06", name: "뉴스 타임라인", family: "news", description: "사건의 순서와 확인할 내용을 차례로 정리", bg: "#F0F5FC", ink: "#17385C", accent: "#2459A8", soft: "#DDE8F8", onAccent: "#FFFFFF", body: "timeline", art: "city" },
  { id: "n07", name: "한 문장 브리핑", family: "news", description: "핵심 문장을 크게 보여 주는 해설형 카드", bg: "#194C49", ink: "#F8F3E6", accent: "#F0D3A0", soft: "#275D58", onAccent: "#1D423D", body: "framed", art: "globe" },
  { id: "n08", name: "팩트 인덱스", family: "news", description: "확인된 정보와 미확인 내용을 구분하는 구성", bg: "#E8EFFC", ink: "#172F66", accent: "#224EB0", soft: "#D6E1F5", onAccent: "#FFFFFF", body: "index", art: "globe" },
  { id: "n09", name: "두 가지 시선", family: "news", description: "분할 화면으로 관점과 질문을 나란히 배치", bg: "#F5E8E3", ink: "#253749", accent: "#2C5275", soft: "#E5D2C9", onAccent: "#FFFFFF", body: "split", art: "city" },
  { id: "n10", name: "미니멀 업데이트", family: "news", description: "작은 업데이트 표시와 큰 제목에 집중", bg: "#FAF8F3", ink: "#22262B", accent: "#AA342B", soft: "#EEEBE3", onAccent: "#FFFFFF", body: "notes", art: "city" },
];
export const cardDesign = (id: string) => CARD_DESIGNS.find(d => d.id === id);
export const collectionUsesArt = (id: string) => !["r02", "r07", "n04", "n07", "n08", "n10"].includes(id);
