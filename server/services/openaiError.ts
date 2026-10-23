/** Read a bounded error body only to classify it; never return provider text or credentials. */
export async function openaiFailureMessage(response: Response): Promise<string> {
  let code = "";
  let message = "";
  const reader = response.body?.getReader();
  if (reader) {
    try {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 16_384) { await reader.cancel(); break; }
        chunks.push(part.value);
      }
      if (bytes <= 16_384) {
        const error = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error;
        if (typeof error?.code === "string") code = error.code;
        if (typeof error?.message === "string") message = error.message.toLowerCase();
      }
    } catch { /* Fall back to status only, never echo the response. */ }
    finally { reader.releaseLock(); }
  }
  const status = response.status;
  const prefix = `OpenAI HTTP ${status}: `;
  if (code === "invalid_api_key") return prefix + "API 키가 유효하지 않거나 폐기되었습니다. 설정에서 해당 프로젝트의 유효한 API 키를 저장한 뒤 연결 확인을 실행하세요.";
  if ((status === 401 || status === 403) && /organization.{0,40}(must be verified|verification required)|verify your organization/.test(message)) {
    return prefix + "이 모델은 OpenAI 조직 인증이 필요합니다. OpenAI Platform의 조직 인증과 모델 사용 권한을 확인하세요.";
  }
  if (code === "insufficient_quota") return prefix + "OpenAI API 크레딧 또는 프로젝트 사용 한도를 확인하세요. ChatGPT 구독과 API 결제는 별도입니다.";
  if (status === 401) return prefix + "인증이 거부되었습니다. API 키의 유효성·프로젝트와 필요한 엔드포인트 권한을 확인하세요. 현재 정보만으로 원인을 확정할 수 없습니다.";
  if (status === 403) return prefix + "접근이 거부되었습니다. 프로젝트·API 키의 모델 및 요청 권한과 조직·지역 제한을 확인하세요. 키를 다시 입력하는 것만으로 해결되지 않을 수 있습니다.";
  if (status === 404) return prefix + "모델을 찾을 수 없거나 접근할 수 없습니다. 설정의 모델 ID와 프로젝트의 모델 접근 권한을 확인하세요.";
  if (status === 429) return prefix + "호출 한도 초과 또는 API 크레딧 부족입니다. 사용량과 결제를 확인하세요.";
  if (status === 400) return prefix + "요청을 처리할 수 없습니다. 모델과 입력 내용을 확인하세요.";
  return prefix + "API 연결 오류입니다. 잠시 후 연결 상태를 확인하세요.";
}
