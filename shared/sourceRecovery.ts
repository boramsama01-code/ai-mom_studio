/** Display actionable recovery for old and current records without inventing article text. */
export type SourceRecovery = { code: string; label: string; reason: string; nextStep: string; links: Array<{ label: string; url: string }> };
type Source = { originalUrl: string; title: string; fetchStatus: string; fetchError: string | null; meta: Record<string, unknown> };
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function sourceRecovery(source: Source): SourceRecovery {
  const error = source.fetchError || "", links: SourceRecovery["links"] = [];
  const original = httpUrl(source.originalUrl), publisher = httpUrl(source.meta.publisherUrl);
  const direct = httpUrl(source.meta.finalUrl) || httpUrl(source.meta.fetchUrl);
  const google = (url: string | null) => !!url && new URL(url).hostname === "news.google.com";
  if (direct && !google(direct)) links.push({ label: "언론사 원문 열기", url: direct });
  if (original && !links.some(l => l.url === original)) links.push({ label: google(original) ? "Google 뉴스에서 원문 열기" : "수집한 원문 열기", url: original });
  if (publisher) {
    links.push({ label: "언론사 사이트 열기", url: publisher });
    if (source.title.trim()) links.push({ label: "제목으로 원문 찾기", url: "https://www.google.com/search?q=" + encodeURIComponent(`site:${new URL(publisher).hostname} "${source.title.slice(0, 500)}"`) });
  }
  const result = (code: string, label: string, reason: string, nextStep: string): SourceRecovery => ({ code, label, reason, nextStep, links });
  if (source.fetchStatus === "ok") return result("ok", "본문 확보됨", "확보한 본문을 아래에서 확인할 수 있습니다.", "게시 전 원문과 날짜·근거를 확인하세요.");
  if (source.fetchStatus === "not_fetched") return result("not_fetched", "아직 본문을 조회하지 않았습니다", "수집한 제목·요약과 기사 본문은 별개입니다.", "원문 다시 확보를 눌러 공개 본문을 조회하세요.");
  if (error.includes("본문을 찾지 못함(동적 페이지·차단 가능성)")) return result("legacy_unresolved", "이전 수집 실패 · 원문 주소 재확인 필요", google(original) ? "이전 수집기가 Google 뉴스 중간 페이지에서 본문을 찾지 못한 기록입니다. 언론사 원문의 차단 여부는 확인되지 않았습니다." : "이전 수집기의 포괄적인 오류 기록입니다. 동적 페이지인지 접근 제한인지 아직 구분되지 않았습니다.", "원문 다시 확보로 새 추출기를 실행하세요. 찾지 못하면 언론사 사이트나 제목 검색으로 확인한 뒤 본문을 직접 붙여넣을 수 있습니다.");
  if (/429|호출 한도|요청 한도/.test(error)) return result("rate_limit", "요청 한도에 도달했습니다", error, "이번 실행에서는 멈췄습니다. 잠시 후 직접 다시 확보하거나 원문 링크로 확인하세요.");
  if (source.fetchStatus === "blocked") return result("restricted", "자동 열람이 제한된 출처입니다", error, "로그인·구독·봇 확인은 자동 통과하지 않습니다. 열람 권한이 있는 원문을 직접 확인하고 필요한 본문만 붙여넣으세요.");
  if (/PDF|스캔/.test(error)) return result("pdf_manual", "PDF 직접 확인이 필요합니다", error, "첨부 PDF를 열어 확인하세요. 텍스트가 없는 스캔본은 자동 본문으로 저장하지 않습니다.");
  if (/제목|중간 링크|원문 연결|언론사 주소/.test(error)) return result("unresolved_link", "원문 주소를 확인하지 못했습니다", error, "언론사 사이트 또는 제목 검색에서 같은 기사인지 확인하세요. 확인한 원문의 본문은 직접 붙여넣을 수 있습니다.");
  if (/자바스크립트|공개 HTML|형식/.test(error)) return result("unsupported_body", "공개 응답에서 본문을 추출하지 못했습니다", error, "원문·첨부를 직접 열어 확인해 주세요. 제목·요약을 본문으로 대신 저장하지 않았습니다.");
  return result("fetch_failed", "원문 조회를 완료하지 못했습니다", error || "연결 또는 응답을 확인해야 합니다.", "원문 링크가 유효한지 확인하고 다시 확보하거나 본문을 직접 붙여넣으세요.");
}
