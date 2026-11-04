/** Only classifies application-safe messages. Never pass a provider response body here. */
export type StudioGenerationFailureKind = "not_configured" | "auth" | "quota" | "rate_limit" | "overload" | "timeout" | "parse" | "cancelled" | "conflict" | "unknown";
export type StudioGenerationFeedback = { kind: StudioGenerationFailureKind; guidance: string; manualFallback: boolean; outcomeUnknown: boolean };

export function studioGenerationFeedback(message: string, status?: string): StudioGenerationFeedback {
  const text = message ?? "";
  if (status === "cancelled" || /생성을 중단|작업을 취소|전역 정지|서버 종료/.test(text)) return { kind: "cancelled", guidance: "이미 저장된 결과는 유지됩니다. 진행 중이던 요청의 처리·과금 여부는 공급자에서 확인한 뒤 필요한 부분만 다시 요청하세요.", manualFallback: true, outcomeUnknown: true };
  if (/설정되지|등록되지|연결하지|미연결|키가 없|API 키.*(?:필요|등록|먼저 입력)|먼저.*(?:키|연결).*설정/.test(text)) return { kind: "not_configured", guidance: "연결 설정에서 API 키를 확인하세요. 자동 선택과 기존 입력은 유지되며, 원하면 수동으로 계속할 수 있습니다.", manualFallback: true, outcomeUnknown: false };
  if (/인증|API 키.*(?:유효|올바르지)|조직.*(?:인증|검증)|HTTP\s*(?:401|403)/i.test(text)) return { kind: "auth", guidance: "API 키·프로젝트 권한과 조직 인증을 확인하세요. 같은 요청을 반복해도 해결되지 않으므로 연결을 고친 뒤 필요한 부분만 요청하세요.", manualFallback: true, outcomeUnknown: false };
  if (/호출 한도 초과 또는 API 크레딧|호출 한도.*또는.*크레딧/i.test(text)) return { kind: "unknown", guidance: "호출 속도 제한과 크레딧 부족 중 어느 쪽인지 아직 확정할 수 없습니다. 공급자의 사용량·결제 화면을 확인하고 필요한 부분만 직접 다시 요청하세요.", manualFallback: true, outcomeUnknown: false };
  if (/호출 속도|요청 속도|속도 제한|요청.*너무 많|짧은 시간에 요청|분당|rate.?limit/i.test(text)) return { kind: "rate_limit", guidance: "호출 제한이 풀릴 때까지 기다린 뒤 실패한 부분만 다시 요청하세요. 자동으로 반복 호출하지 않습니다.", manualFallback: true, outcomeUnknown: false };
  if (/잔액|크레딧|과금|결제|지출 한도|월간 사용 한도|일일 한도|일일.*할당량|spend|quota/i.test(text) && !/처리·과금|처리.*여부|과금.*여부/.test(text)) return { kind: "quota", guidance: "공급자의 잔액·요금제·사용 한도를 확인하세요. 이미 만든 결과를 보존하며, 한도 복구 전에는 직접 수정하거나 수동으로 이어갈 수 있습니다.", manualFallback: true, outcomeUnknown: false };
  if (/시간.*초과|타임아웃|응답 대기|응답.*받지|처리.*확인할 수|실행 권한.*만료|중단된 유료/i.test(text)) return { kind: "timeout", guidance: "응답을 받지 못해 공급자의 처리·과금 여부가 미확정입니다. 사용 내역을 확인한 뒤 필요한 부분만 직접 다시 요청하세요.", manualFallback: true, outcomeUnknown: true };
  if (/HTTP\s*50[0234]|과부하|일시.*(?:오류|문제)|일시적으로.*(?:사용|처리)|UNAVAILABLE/i.test(text)) return { kind: "overload", guidance: "공급자가 일시적으로 요청을 처리하지 못했습니다. 잠시 후 실패한 부분만 다시 요청하거나 직접 편집을 계속하세요.", manualFallback: true, outcomeUnknown: false };
  if (/생성 전 콘텐츠가|다른.*버전|최신.*수정|버전.*충돌|직접 수정한/.test(text)) return { kind: "conflict", guidance: "새로 수정한 내용은 유지했습니다. 최신 원고와 생성 기록을 확인한 뒤 필요한 부분만 적용하세요.", manualFallback: false, outcomeUnknown: false };
  if (/형식|파싱|읽을 수 없|완전한 초안|유효한.*(?:JSON|결과)/i.test(text)) return { kind: "parse", guidance: "생성 결과를 적용할 수 없어 기존 작업을 유지했습니다. 결과 기록과 입력을 확인하고 직접 수정하거나 필요한 부분만 다시 요청하세요.", manualFallback: true, outcomeUnknown: false };
  return { kind: "unknown", guidance: "기존 입력과 저장된 결과는 유지됩니다. 작업 기록과 연결 상태를 확인한 뒤 필요한 부분만 다시 요청하세요.", manualFallback: true, outcomeUnknown: false };
}

export type StudioImageProgress = {
  cardId: number;
  kind: "image";
  panelIndex: number | null;
  panelIndexes: number[];
  completedPanels: Array<{ panelIndex: number; imageId: number; revisionId: number; version: number; applied: boolean }>;
  remainingPanelIndexes: number[];
  activePanelIndex: number | null;
  applied: boolean;
  partial: boolean;
  message: string;
  revisionId?: number;
  errorKind?: StudioGenerationFailureKind;
};

/** Ignore old/non-image job results rather than assuming a new response shape. */
export function studioImageProgress(value: unknown): StudioImageProgress | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<StudioImageProgress>;
  if (result.kind !== "image" || !Array.isArray(result.panelIndexes) || !Array.isArray(result.completedPanels) || !Array.isArray(result.remainingPanelIndexes)) return null;
  return result as StudioImageProgress;
}
