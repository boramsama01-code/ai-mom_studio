/**
 * 화면에서 입력할 수 있는 연결 키 목록 (클라이언트/서버 공용)
 * secret=true 인 값은 저장 후 다시 보여주지 않는다.
 */
export type SecretField = { key: string; label: string; secret: boolean; hint?: string; placeholder?: string; options?: { value: string; label: string }[] };
export type SecretGroup = { id: string; title: string; description: string; docs?: string; fields: SecretField[]; testable: boolean };

export const SECRET_GROUPS: SecretGroup[] = [
  {
    id: "ai",
    title: "글쓰기 AI 선택",
    description: "글은 선택한 AI로, 그림은 OpenAI로 만듭니다. 다른 AI 비교는 콘텐츠에서 직접 선택할 때만 실행됩니다.",
    testable: false,
    fields: [
      { key: "AI_PROVIDER", label: "기본 글쓰기 AI", secret: false, hint: "자동 선택은 등록된 키 중 Gemini → GPT → Claude 순서입니다. 호출 실패 시 다른 AI로 전환하지 않습니다.", options: [{ value: "auto", label: "자동 선택 · Gemini 우선" }, { value: "gemini", label: "Gemini · Google" }, { value: "openai", label: "GPT · OpenAI" }, { value: "anthropic", label: "Claude · Anthropic" }] },
    ],
  },
  {
    id: "gemini", title: "Gemini · 무료 등급 지원",
    description: "Google AI Studio에서 무료 등급 프로젝트의 키를 등록하세요. 기본 모델은 Gemini 2.5 Flash입니다. 무료 등급의 입력·응답은 Google 제품 개선에 사용될 수 있습니다. 한도는 프로젝트·모델별이며 유료 등급 프로젝트는 과금됩니다. 이 스튜디오는 결제를 연결하거나 다른 AI로 자동 전환하지 않습니다.",
    docs: "https://aistudio.google.com/api-keys", testable: true,
    fields: [
      { key: "GEMINI_API_KEY", label: "Gemini API 키", secret: true },
      { key: "GEMINI_MODEL", label: "글 모델", secret: false, placeholder: "gemini-2.5-flash", hint: "기본값: gemini-2.5-flash. 변경 전 해당 모델의 무료 등급 지원 여부를 확인하세요." },
    ],
  },
  {
    id: "openai",
    title: "GPT · 이미지 생성",
    description: "ChatGPT 구독과 별도인 API입니다. 대상 조직은 입력·출력 데이터 공유를 활성화하면 대상 모델의 일일 무료 토큰을 받을 수 있습니다. 양수 잔액이 필요하며 한도를 넘기는 요청은 전체가 과금됩니다. 이미지·도구 등은 별도 요금입니다. 키 조회 성공만으로 무료 혜택이 확인되지는 않습니다.",
    docs: "https://platform.openai.com/api-keys",
    testable: true,
    fields: [
      { key: "OPENAI_API_KEY", label: "API 키", secret: true, placeholder: "sk-..." },
      { key: "OPENAI_MODEL", label: "글 모델", secret: false, placeholder: "gpt-6.1-sol", hint: "기본값: gpt-6.1-sol. 무료 토큰의 mini 그룹을 사용하려면 gpt-5-mini-2025-08-07을 입력하고 대상 모델 목록을 확인하세요." },
      { key: "OPENAI_IMAGE_MODEL", label: "이미지 모델", secret: false, placeholder: "gpt-image-2.5-sunburst", hint: "기본값: gpt-image-2.5-sunburst" },
    ],
  },
  {
    id: "naver",
    title: "네이버 검색 API",
    description: "뉴스·블로그 검색 수집에 사용합니다. 2026년 8월부터 새 키는 네이버 클라우드의 NAVER API HUB에서 받습니다(검색 이용 신청 → Application 등록 → Client ID/Secret). 예전 개발자센터 키도 2027년 6월까지는 그대로 됩니다.",
    docs: "https://guide.ncloud-docs.com/docs/apihub-migration",
    testable: true,
    fields: [
      { key: "NAVER_CLIENT_ID", label: "Client ID", secret: false, hint: "네이버의 Application 인증 정보에 표시된 발급 ID를 붙여 넣으세요. 직접 정한 앱 이름은 인증 ID로 사용할 수 없습니다." },
      { key: "NAVER_CLIENT_SECRET", label: "Client Secret", secret: true },
    ],
  },
  {
    id: "anthropic",
    title: "Claude (선택)",
    description: "다른 글 초안을 비교하거나 기본 글쓰기 AI로 선택할 때 사용합니다. 별도 API 사용료가 발생합니다.",
    docs: "https://console.anthropic.com/settings/keys",
    testable: true,
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API 키", secret: true, placeholder: "sk-ant-..." },
      { key: "ANTHROPIC_MODEL", label: "모델 ID", secret: false, placeholder: "claude-sonnet-5-5", hint: "기본값: claude-sonnet-5-5" },
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
    description: "노션 원고와 사진으로 편집 가능한 Canva 디자인을 만들고, 완성본을 스튜디오로 가져옵니다. 템플릿 자동 채우기는 연결한 계정의 기능과 권한에 따라 사용할 수 있습니다. Canva 개발자 페이지(Your apps)에서 앱을 만들고 'Outside Canva'에 권한과 리디렉트 주소를 넣은 뒤, 아래 두 값을 저장하고 'Canva 연결'을 누르세요.",
    docs: "https://www.canva.com/developers/apps",
    testable: false,
    fields: [
      { key: "CANVA_CLIENT_ID", label: "Client ID", secret: false },
      { key: "CANVA_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    id: "notion",
    title: "Notion · 콘텐츠 제작표",
    description: "콘텐츠 제작표를 공유한 Notion 연결의 키를 등록하세요. 원고와 사진을 스튜디오로 직접 가져오고, 비교 후 원고를 다시 반영할 때 사용합니다. 저장하거나 상태를 바꾸는 것만으로 AI 생성이나 게시가 실행되지는 않습니다.",
    docs: "https://www.notion.so/profile/integrations",
    testable: true,
    fields: [
      { key: "NOTION_API_TOKEN", label: "Notion 연결 키", secret: true, hint: "노션에서 콘텐츠 제작표를 이 연결에 공유해야 합니다. 키는 서버에만 저장하며 다시 표시하지 않습니다." },
      { key: "NOTION_CONTENT_DATA_SOURCE_ID", label: "콘텐츠 제작 데이터 소스 ID", secret: false, placeholder: "e5a4b4f7-f2f6-4fad-b514-1602a2b12b2b", hint: "기존 콘텐츠 제작표는 비워 두어도 됩니다. 데이터베이스 링크의 ID와 데이터 소스 ID는 다릅니다." },
    ],
  },
  {
    id: "instagram",
    title: "인스타그램 API 버전",
    description: "인스타그램 연결 화면에서 네 계정을 연결하고 확인하세요. API 버전은 Meta 앱에서 지원하는 버전으로 설정합니다.",
    docs: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
    testable: false,
    fields: [{ key: "INSTAGRAM_API_VERSION", label: "API 버전", secret: false, placeholder: "예: v25.0", hint: "Meta Graph API 버전 번호. 공식 버전 표(developers.facebook.com/docs/graph-api/changelog/versions)에서 만료일이 먼 버전을 넣습니다." }],
  },
  {
    id: "meta-instagram",
    title: "Instagram 로그인 연결",
    description: "Meta 통합 로그인에 사용하는 앱 설정입니다. 한 번 준비하면 각 계정 카드에서 로그인하여 연결할 수 있습니다.",
    docs: "https://developers.facebook.com/apps/",
    testable: false,
    fields: [
      { key: "META_APP_ID", label: "Meta 앱 ID", secret: false, hint: "Meta 앱 대시보드의 앱 ID입니다." },
      { key: "META_APP_SECRET", label: "Meta 앱 시크릿", secret: true, hint: "서버에 암호화해 저장하며 저장 후에는 다시 표시하지 않습니다." },
      { key: "META_INSTAGRAM_CONFIG_ID", label: "통합 로그인 구성 ID", secret: false, hint: "Facebook Login for Business에서 Instagram 자산으로 만든 구성 ID입니다." },
    ],
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
