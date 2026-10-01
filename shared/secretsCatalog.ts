/**
 * 화면에서 입력할 수 있는 연결 키 목록 (클라이언트/서버 공용)
 * secret=true 인 값은 저장 후 다시 보여주지 않는다.
 */
export type SecretField = { key: string; label: string; secret: boolean; hint?: string; placeholder?: string };
export type SecretGroup = { id: string; title: string; description: string; docs?: string; fields: SecretField[]; testable: boolean };

export const SECRET_GROUPS: SecretGroup[] = [
  {
    id: "naver",
    title: "네이버 검색 API",
    description: "뉴스·블로그 검색 수집에 사용합니다. 2026년 8월부터 새 키는 네이버 클라우드의 NAVER API HUB에서 받습니다(검색 이용 신청 → Application 등록 → Client ID/Secret). 예전 개발자센터 키도 2027년 6월까지는 그대로 됩니다.",
    docs: "https://guide.ncloud-docs.com/docs/apihub-migration",
    testable: true,
    fields: [
      { key: "NAVER_CLIENT_ID", label: "Client ID", secret: false },
      { key: "NAVER_CLIENT_SECRET", label: "Client Secret", secret: true },
    ],
  },
  {
    id: "anthropic",
    title: "Claude API",
    description: "공고 구조화 추출과 과학·시사 초안에 사용합니다. 사용량만큼 요금이 나옵니다.",
    docs: "https://console.anthropic.com/settings/keys",
    testable: true,
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API 키", secret: true, placeholder: "sk-ant-..." },
      { key: "ANTHROPIC_MODEL", label: "모델 ID", secret: false, hint: "Claude 문서의 모델 목록에 있는 ID를 그대로 입력" },
    ],
  },
  {
    id: "telegram",
    title: "텔레그램",
    description: "봇 토큰은 @BotFather에서 받습니다. 검토 알림을 받으려면 봇과의 1:1 대화에서 /start를 먼저 보내세요.",
    docs: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    testable: true,
    fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "봇 토큰", secret: true, placeholder: "123456:ABC..." },
      { key: "TELEGRAM_REVIEW_CHAT_ID", label: "개인 검토 알림 채팅 ID", secret: false, hint: "공개 채널이 아니라 내 개인 채팅 ID(숫자)" },
    ],
  },
  {
    id: "cloudinary",
    title: "Cloudinary (이미지 공개 주소)",
    description: "인스타그램 게시에 필요합니다. 인스타그램을 쓰지 않으면 비워 두세요.",
    docs: "https://console.cloudinary.com/",
    testable: true,
    fields: [
      { key: "CLOUDINARY_CLOUD_NAME", label: "Cloud name", secret: false },
      { key: "CLOUDINARY_API_KEY", label: "API Key", secret: false },
      { key: "CLOUDINARY_API_SECRET", label: "API Secret", secret: true },
    ],
  },
  {
    id: "canva",
    title: "Canva (선택)",
    description: "Canva 브랜드 템플릿에 글자를 자동으로 채워 디자인을 만듭니다(Canva Pro 이상). Canva 개발자 페이지(Your apps)에서 앱을 만들고 'Outside Canva'에 권한과 리디렉트 주소를 넣은 뒤, 아래 두 값을 저장하고 'Canva 연결'을 누르세요.",
    docs: "https://www.canva.com/developers/apps",
    testable: false,
    fields: [
      { key: "CANVA_CLIENT_ID", label: "Client ID", secret: false },
      { key: "CANVA_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    id: "instagram",
    title: "인스타그램 API 버전",
    description: "Instagram API with Instagram Login 문서에서 확인한 버전(예: vNN.0). 계정별 토큰은 아래 '게시 목적지'에서 입력합니다.",
    docs: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
    testable: false,
    fields: [{ key: "INSTAGRAM_API_VERSION", label: "API 버전", secret: false, placeholder: "v00.0" }],
  },
];

export const STATIC_SECRET_KEYS = new Set(SECRET_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

/** 목적지별 키(IG_<채널>_*, TG_<채널>_*) — 토큰만 비밀값 */
export function destinationKeyIsSecret(key: string): boolean {
  return /_ACCESS_TOKEN$/.test(key);
}

export function isAllowedSecretKey(key: string, channelSlugs: string[]): boolean {
  if (STATIC_SECRET_KEYS.has(key)) return true;
  return channelSlugs.some((slug) => new RegExp(`^(IG|TG)_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_[A-Z0-9_]{2,40}$`).test(key));
}

export function isSecretKey(key: string): boolean {
  for (const g of SECRET_GROUPS) for (const f of g.fields) if (f.key === key) return f.secret;
  return destinationKeyIsSecret(key);
}
