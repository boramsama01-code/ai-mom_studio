/** 콘텐츠 유형별 편집기 — 운영자 수정값은 새 버전으로 저장된다 */
import type { ReactNode } from "react";
import { NOTICE_CATEGORIES } from "@shared/domain";

type P = Record<string, any>;
type Props = { value: P; onChange: (v: P) => void };

function Text({ label, value, onChange, hint, multiline, rows }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; hint?: string; multiline?: boolean; rows?: number }) {
  return (
    <label className="field">
      {label}
      {hint && <span className="hint">{hint}</span>}
      {multiline ? (
        <textarea rows={rows ?? 3} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
      )}
    </label>
  );
}

function Lines({ label, value, onChange, hint }: { label: string; value: string[] | undefined; onChange: (v: string[]) => void; hint?: string }) {
  return (
    <label className="field">
      {label}
      <span className="hint">{hint ?? "한 줄에 하나씩"}</span>
      <textarea rows={Math.max(3, (value?.length ?? 0) + 1)} value={(value ?? []).join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
    </label>
  );
}

function Fixed({ label, value, count, onChange }: { label: string; value: string[] | undefined; count: number; onChange: (v: string[]) => void }) {
  const arr = Array.from({ length: count }, (_, i) => value?.[i] ?? "");
  return (
    <fieldset className="stack">
      <legend>{label}</legend>
      {arr.map((v, i) => (
        <label key={i} className="field">
          <span className="sr-only">
            {label} {i + 1}
          </span>
          <textarea rows={2} value={v} onChange={(e) => onChange(arr.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} ${i + 1}`} />
        </label>
      ))}
    </fieldset>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string | null | undefined; options: Array<[string, string]>; onChange: (v: string | null) => void }) {
  return (
    <label className="field">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const set = (p: P, onChange: (v: P) => void) => (k: string) => (v: unknown) => onChange({ ...p, [k]: v });

/* ───────────── 공고 ───────────── */
const SCH_KIND: Array<[string, string]> = [["apply", "접수"], ["event", "행사·설명회"], ["reservation", "설명회 예약"], ["result", "결과 발표"], ["correction", "정정 안내"], ["other", "기타"]];

export function NoticeEditor({ value: p, onChange }: Props) {
  const s = set(p, onChange);
  const schedules: P[] = p.schedules ?? [];
  const setSch = (i: number, patch: P) => s("schedules")(schedules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const point = (pt: P | null | undefined, k: "date" | "time", v: string) => {
    const next = { date: pt?.date ?? "", time: pt?.time ?? null, [k]: v || (k === "time" ? null : "") };
    return next.date ? next : null;
  };
  return (
    <div className="stack">
      <Section title="기본 정보">
        <Select label="관련성" value={p.relevance} onChange={s("relevance")} options={[["relevant", "관련 있음"], ["uncertain", "판단 필요"], ["irrelevant", "관련 없음"]]} />
        <Text label="공고 제목" value={p.title} onChange={s("title")} />
        <Text label="기관(학교·주최)" value={p.organization} onChange={s("organization")} />
        <div className="grid grid-2">
          <Select label="카테고리" value={p.category} onChange={s("category")} options={[["", "미분류"], ...NOTICE_CATEGORIES.map((c) => [c, c] as [string, string])]} />
          <Select
            label="학교 유형"
            value={p.school_type}
            onChange={s("school_type")}
            options={[["", "미확인"], ["national_autonomous", "전국단위 자사고"], ["gifted", "영재학교"], ["science_high", "과학고"], ["org", "기관·대학"]]}
          />
          <Select
            label="공고 유형"
            value={p.notice_type}
            onChange={s("notice_type")}
            options={[["", "미확인"], ...["입학설명회", "모집요강", "원서접수", "추가모집", "정정공고", "결과발표", "캠프모집", "대회접수", "영재교육원모집", "기타"].map((x) => [x, x] as [string, string])]}
          />
          <Text label="모집 학년도" value={p.academic_year} onChange={s("academic_year")} hint="예: 2027학년도" />
        </div>
        <Text label="대상" value={p.audience} onChange={s("audience")} hint="예: 중학교 3학년" />
        <Text label="지원 자격" value={p.eligibility} onChange={s("eligibility")} multiline />
      </Section>

      <Section title="일정 (한국 시간)">
        <p className="small muted">원문에 시각이 없으면 비워 두세요. 날짜만 있는 마감은 그날 끝까지 접수로 판단합니다.</p>
        {schedules.map((sc, i) => (
          <fieldset key={i} className="stack">
            <legend>일정 {i + 1}</legend>
            <div className="grid grid-2">
              <Select label="종류" value={sc.kind} onChange={(v) => setSch(i, { kind: v ?? "other" })} options={SCH_KIND} />
              <Text label="이름·회차" value={[sc.round, sc.label].filter(Boolean).join(" ") || null} onChange={(v) => setSch(i, { label: v, round: null })} />
              <label className="field">
                시작 날짜
                <input type="date" value={sc.start?.date ?? ""} onChange={(e) => setSch(i, { start: point(sc.start, "date", e.target.value) })} />
              </label>
              <label className="field">
                시작 시각(선택)
                <input type="time" value={sc.start?.time ?? ""} disabled={!sc.start?.date} onChange={(e) => setSch(i, { start: point(sc.start, "time", e.target.value) })} />
              </label>
              <label className="field">
                끝 날짜
                <input type="date" value={sc.end?.date ?? ""} onChange={(e) => setSch(i, { end: point(sc.end, "date", e.target.value) })} />
              </label>
              <label className="field">
                끝 시각(선택)
                <input type="time" value={sc.end?.time ?? ""} disabled={!sc.end?.date} onChange={(e) => setSch(i, { end: point(sc.end, "time", e.target.value) })} />
              </label>
            </div>
            <Text label="원문 날짜 표현" value={sc.raw} onChange={(v) => setSch(i, { raw: v })} />
            <div>
              <button type="button" className="btn sm danger" onClick={() => s("schedules")(schedules.filter((_, j) => j !== i))}>
                이 일정 삭제
              </button>
            </div>
          </fieldset>
        ))}
        <div>
          <button type="button" className="btn sm" onClick={() => s("schedules")([...schedules, { kind: "apply", label: null, round: null, start: null, end: null, raw: null }])}>
            일정 추가
          </button>
        </div>
        <Select label="마감 방식" value={p.deadline_type} onChange={(v) => s("deadline_type")(v ?? "unknown")} options={[["fixed", "기간 마감"], ["first_come", "선착순"], ["tbd", "추후 공지"], ["unknown", "확인 필요"]]} />
      </Section>

      <Section title="내용">
        <Text label="한 줄 요약" value={p.one_line_summary} onChange={s("one_line_summary")} multiline rows={2} />
        <Text label="주요 내용 (선착순 여부, 제출 서류, 혜택 등)" value={p.key_details} onChange={s("key_details")} multiline rows={4} />
        <Lines label="불확실한 점" value={p.uncertainties} onChange={s("uncertainties")} />
        <label className="check">
          <input type="checkbox" checked={!!p.has_conflict} onChange={(e) => s("has_conflict")(e.target.checked)} /> 자료 간 내용이 충돌함
        </label>
      </Section>
    </div>
  );
}

/* ───────────── 과학 대화 ───────────── */
export function ScienceEditor({ value: p, onChange }: Props) {
  const s = set(p, onChange);
  return (
    <div className="stack">
      <Text label="주제" value={p.topic} onChange={(v) => s("topic")(v ?? "")} />
      <Text label="연령대" value={p.age_band} onChange={(v) => s("age_band")(v ?? "")} />
      <Text label="핵심 질문 (카드 제목)" value={p.key_question} onChange={(v) => s("key_question")(v ?? "")} multiline rows={2} />
      <Fixed label="쉬운 배경 (3문장)" value={p.background} count={3} onChange={s("background")} />
      <Fixed label="대화 질문 (3개)" value={p.discussion_questions} count={3} onChange={s("discussion_questions")} />
      <Text label="과학적 근거" value={p.scientific_basis} onChange={(v) => s("scientific_basis")(v ?? "")} multiline rows={4} />
      <Lines label="흔한 오개념" value={p.misconceptions} onChange={s("misconceptions")} />
      <Lines label="부모 진행 힌트" value={p.parent_hints} onChange={s("parent_hints")} hint="정답 강요 대신 '그렇게 생각한 근거는?' 같은 질문" />
      <Text label="안전한 관찰 활동 (선택)" value={p.safe_activity} onChange={s("safe_activity")} multiline rows={2} />
    </div>
  );
}

/* ───────────── 시사 대화 ───────────── */
export function CurrentEditor({ value: p, onChange }: Props) {
  const s = set(p, onChange);
  const persp: P[] = p.perspectives ?? [];
  const gl: P[] = p.glossary ?? [];
  return (
    <div className="stack">
      <Text label="제목" value={p.title} onChange={(v) => s("title")(v ?? "")} />
      <div className="grid grid-2">
        <Text label="사건 시각" value={p.event_at} onChange={s("event_at")} />
        <Text label="보도 시각" value={p.published_at} onChange={s("published_at")} />
      </div>
      <Text label="확인 시각" value={p.checked_at} onChange={s("checked_at")} />
      <Text label="사건 요약" value={p.summary} onChange={(v) => s("summary")(v ?? "")} multiline rows={4} />
      <Text label="왜 중요한가" value={p.why_it_matters} onChange={(v) => s("why_it_matters")(v ?? "")} multiline />
      <Lines label="확인된 사실" value={p.verified_facts} onChange={s("verified_facts")} />
      <Lines label="확인 중인 내용" value={p.under_verification} onChange={s("under_verification")} />
      <fieldset className="stack">
        <legend>이해관계자별 관점</legend>
        {persp.map((x, i) => (
          <div key={i} className="grid grid-2">
            <Text label="이해관계자" value={x.stakeholder} onChange={(v) => s("perspectives")(persp.map((y, j) => (j === i ? { ...y, stakeholder: v ?? "" } : y)))} />
            <Text label="관점" value={x.view} onChange={(v) => s("perspectives")(persp.map((y, j) => (j === i ? { ...y, view: v ?? "" } : y)))} />
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn sm" onClick={() => s("perspectives")([...persp, { stakeholder: "", view: "" }])}>관점 추가</button>
          {persp.length > 0 && <button type="button" className="btn sm danger" onClick={() => s("perspectives")(persp.slice(0, -1))}>마지막 관점 삭제</button>}
        </div>
      </fieldset>
      <Fixed label="대화 질문 (3개)" value={p.discussion_questions} count={3} onChange={s("discussion_questions")} />
      <fieldset className="stack">
        <legend>어려운 단어</legend>
        {gl.map((x, i) => (
          <div key={i} className="grid grid-2">
            <Text label="단어" value={x.term} onChange={(v) => s("glossary")(gl.map((y, j) => (j === i ? { ...y, term: v ?? "" } : y)))} />
            <Text label="뜻" value={x.meaning} onChange={(v) => s("glossary")(gl.map((y, j) => (j === i ? { ...y, meaning: v ?? "" } : y)))} />
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn sm" onClick={() => s("glossary")([...gl, { term: "", meaning: "" }])}>단어 추가</button>
          {gl.length > 0 && <button type="button" className="btn sm danger" onClick={() => s("glossary")(gl.slice(0, -1))}>마지막 단어 삭제</button>}
        </div>
      </fieldset>
      <Lines label="부모 진행 힌트" value={p.parent_hints} onChange={s("parent_hints")} />
    </div>
  );
}

export function PayloadEditor({ kind, value, onChange }: { kind: string } & Props) {
  if (kind === "science_dialogue") return <ScienceEditor value={value} onChange={onChange} />;
  if (kind === "current_dialogue") return <CurrentEditor value={value} onChange={onChange} />;
  return <NoticeEditor value={value} onChange={onChange} />;
}

export const FIELD_LABEL: Record<string, string> = {
  title: "제목", organization: "기관", audience: "대상", eligibility: "자격", schedules: "일정", academic_year: "학년도",
  key_details: "주요 내용", one_line_summary: "한 줄 요약", category: "카테고리", notice_type: "공고 유형", deadline_type: "마감 방식",
  scientific_basis: "과학 근거", background: "배경", summary: "요약", verified_facts: "확인된 사실", perspectives: "관점",
};

/** 저장 전 정리: 줄 목록의 빈 줄 제거, 문자열 앞뒤 공백 정리 */
const LINE_FIELDS = ["uncertainties", "misconceptions", "parent_hints", "verified_facts", "under_verification"];
export function cleanPayload(p: P): P {
  const out: P = { ...p };
  for (const k of LINE_FIELDS) if (Array.isArray(out[k])) out[k] = out[k].map((x: string) => x.trim()).filter(Boolean);
  if (Array.isArray(out.schedules)) out.schedules = out.schedules.map((s: P) => ({ ...s, start: s.start?.date ? s.start : null, end: s.end?.date ? s.end : null }));
  return out;
}
