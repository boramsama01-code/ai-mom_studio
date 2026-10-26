import { z } from "zod";

export const collectionDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00+09:00`);
  return !Number.isNaN(d.getTime()) && kstDay(d) === value;
}, "올바른 날짜를 선택하세요.");
export function kstDay(now = new Date()) { return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10); }
export function collectionDayRange(day: string) {
  collectionDateSchema.parse(day);
  const start = new Date(`${day}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 86400_000) };
}
export const COLLECTION_HOURS_KST = [5, 7, 19];
export function nextCollectionAt(now = new Date()) {
  const { start } = collectionDayRange(kstDay(now));
  return [0, 1].flatMap(day => COLLECTION_HOURS_KST.map(hour => new Date(start.getTime() + (day * 24 + hour) * 3600_000 + 13 * 60_000))).find(t => t > now)!.toISOString();
}

const terms = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);
const schools = terms(`민족사관고
하나고
상산고
외대부고
현대청운고
북일고
김천고
포항제철고
광양제철고
인천하늘고
서울과학고
경기과학고
한국과학영재학교
대전과학고
대구과학고
광주과학고
세종과학예술영재학교
인천과학예술영재학교
한성과학고
세종과학고
경기북과학고
인천과학고
인천진산과학고
부산과학고
부산일과학고
대구일과학고
대전동신과학고
울산과학고
강원과학고
충북과학고
충남과학고
전북과학고
전남과학고
경북과학고
경산과학고
경남과학고
창원과학고
제주과학고`);
type Profile = { label: string; news: string[]; blog: string[]; discovery: string[]; calls: number; results: number };
export const COLLECTION_PROFILES: Record<string, Profile> = {
  opportunities: {
    label: "입시·영재교육·STEM", calls: 100, results: 500, discovery: [], blog: [],
    news: [...schools.map(s => `${s} 입학`), ...terms(`전국단위 자사고 모집요강
자사고 입학설명회
자사고 추가모집
영재학교 모집요강
영재학교 입학설명회
과학고 모집요강
과학고 입학설명회
고입 원서접수
고입 전형일정
고입 사회통합전형
고입 정정공고
과학영재교육원 모집
대학부설 영재교육원 모집
교육청 영재교육원 선발
영재교육원 사사과정
영재교육원 선교육
KAIST 사이버영재교육
KAIST 과학영재교육연구원 모집
동국대 과학영재교육원 모집
가천대 과학영재교육원 모집
서울대 과학영재교육원 모집
연세대 과학영재교육원 모집
한국과학창의재단 청소년 모집
중학생 과학캠프 모집
청소년 과학캠프 모집
중학생 수학캠프 모집
청소년 인공지능 캠프
청소년 코딩 캠프
청소년 로봇 대회
한국코드페어 모집
한국정보올림피아드
한국수학올림피아드
한국물리올림피아드
한국천문올림피아드
청소년과학탐구대회
전국학생과학발명품경진대회
전국과학전람회
청소년 과학 연구 참가
청소년 해커톤 모집
청소년 발명대회 모집
과학관 청소년 프로그램 모집
ASEAN 과학영재 캠프`)],
  },
  "science-dialogue": {
    label: "과학 이야기", calls: 40, results: 300, blog: [],
    discovery: terms(`연구팀 발견
우주 탐사
인공지능 기술
기후 환경 연구
생명과학 연구
물리학 연구
바다 생태계
에너지 신기술`),
    news: terms(`우주 망원경 발견
태양계 탐사
외계행성 발견
블랙홀 연구
달 탐사
화성 탐사
양자컴퓨터 연구
입자물리 연구
핵융합 연구
반도체 신소재
배터리 연구
로봇 연구
인공지능 연구
뇌과학 연구
유전자 연구
진화 생물학
공룡 화석 발견
미생물 연구
해양 생물 발견
기후변화 연구
지진 연구
화산 연구
수학 난제
과학 실험 원리`),
  },
  "current-dialogue": {
    label: "아이와 나누는 시사", calls: 40, results: 300, blog: [],
    discovery: terms(`교육 정책
환경 정책
과학 기술 사회
생활 경제
디지털 시민
국제 협력
청소년 권리
지역 사회 변화`),
    news: terms(`학교 교육 변화
청소년 정책
교육 격차
디지털 교과서
인공지능 윤리
개인정보 보호
가짜뉴스 미디어
저작권 인공지능
기후위기 정책
탄소중립 정책
재생에너지 정책
플라스틱 환경
생물다양성 보호
물가 생활 경제
최저임금 논의
소비자 권리
공정무역
지역 소멸 대응
대중교통 정책
주거 정책
우주 개발 국제협력
국제기구 기후
장애인 접근성
아동 청소년 권리`),
  },
  fryday: {
    label: "Fryday 음식·감자튀김", calls: 32, results: 240, discovery: [],
    news: terms(`감자튀김 신제품
감자튀김 메뉴
프렌치프라이
프렌치 프라이
감자 신품종
감자 식품 연구
튀김 바삭함
튀김 과학
식품공학 튀김
에어프라이어 감자
패스트푸드 신메뉴
버거 감자튀김
푸드테크 신기술
식품 포장 기술
지속가능 식품
음식 문화 트렌드`),
    blog: terms(`감자튀김 비교
감자튀김 실험
감자튀김 소스
감자튀김 레시피
프렌치프라이 리뷰
에어프라이어 감자튀김`),
  },
};

export type CollectionOverview = {
  searchReady?: boolean; sourceMode?: "public_rss"; publicFeeds?: string[];
  date: string; timezone: string; autoCollect: boolean; globalStop: boolean; naverReady: boolean; inlineWorker: boolean;
  nextAt: string | null; lastScheduledAt: string | null;
  channels: Array<{ id: number; version: number; slug: string; name: string; active: boolean; queries: number; discoveryQueries: number; boards: number; budget: number; profile: { label: string; count: number } | null;
    newItems: number; pending: number; fetched: number; jobs: Array<{ id: number; status: string; createdAt: string; stale: boolean }>;
    lastRun: { id: number; status: string; startedAt: string; finishedAt: string | null; counts: Record<string, number>; errors: Array<{ scope: string; message: string }> } | null;
  }>;
};
