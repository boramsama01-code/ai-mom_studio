/**
 * 카드 디자인 — 템플릿 고르기, 내 배경 템플릿 올리기, Canva 자동 채우기, 대량 제작·망고보드용 글자 내보내기
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../api";
import { useChannel } from "../state";
import { useToast } from "../toast";
import { Badge, Empty, ErrorBox, Loading } from "../ui";
import { CARD_FIELD_KEYS } from "@shared/cardFields";

export type Tpl = { key: string; name: string; description: string; kind: "builtin" | "custom"; id?: number; layout?: string; textTone?: string; overlay?: number; allChannels?: boolean };

export function useTemplates(cid: number | "all") {
  return useQuery({ queryKey: ["ch", cid, "templates"], queryFn: () => api<{ items: Tpl[]; current: string }>(`/channels/${cid}/templates`), enabled: cid !== "all" });
}

export function TemplatePicker({ cid, value, onChange, items, version }: { cid: number; value: string; onChange: (k: string) => void; items: Tpl[]; version?: string }) {
  return (
    <div className="tpl-grid" role="group" aria-label="카드 템플릿">
      {items.map((t) => (
        <button key={t.key} type="button" className="tpl" aria-pressed={value === t.key} onClick={() => onChange(t.key)}>
          <img src={`/api/channels/${cid}/templates/preview?size=sm&key=${encodeURIComponent(t.key)}&v=${version ?? ""}`} alt="" loading="lazy" />
          <span className="tpl-name">
            {t.name} {value === t.key && <span className="sr-only">(선택됨)</span>}
          </span>
          <span className="tpl-desc">{t.description}</span>
        </button>
      ))}
    </div>
  );
}

export function DesignPage() {
  const { current, selected } = useChannel();
  if (selected === "all" || !current)
    return (
      <>
        <h1>수집 카드 디자인</h1>
        <Empty>수집함에서 만드는 카드의 디자인입니다. 채널을 하나 선택하세요. Studio 제작물은 각 작업의 내보내기에서 디자인을 고릅니다.</Empty>
      </>
    );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>수집 카드 디자인</h1>
          <p className="small muted" style={{ margin: 0 }}>
            수집함 → 콘텐츠 초안 → 발행함의 카드에 적용됩니다. Studio 제작물은 각 작업의 내보내기에서 디자인을 고릅니다.
          </p>
        </div>
      </div>
      <DefaultTemplate cid={current.id} accent={current.accentColor} />
      <UploadTemplate cid={current.id} />
      <CanvaSection cid={current.id} brandTemplateId={current.canvaBrandTemplateId ?? null} />
      <BulkSection cid={current.id} kind={current.contentType} />
    </>
  );
}

function DefaultTemplate({ cid, accent }: { cid: number; accent: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useTemplates(cid);
  const set = useMutation({
    mutationFn: (key: string) => api(`/channels/${cid}/design`, { method: "PUT", body: { cardTemplate: key } }),
    onSuccess: () => {
      toast("ok", "이 채널의 기본 카드 템플릿을 바꿨습니다. 새로 만드는 카드부터 적용됩니다.");
      qc.invalidateQueries({ queryKey: ["ch", cid, "templates"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  return (
    <section className="panel stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>기본 카드 템플릿</h2>
        <span className="small muted">예시 문구로 보여 줍니다 · 채널 색 {accent}</span>
      </div>
      {q.isLoading ? <Loading lines={1} /> : q.error ? <ErrorBox error={q.error} /> : <TemplatePicker cid={cid} value={q.data!.current} onChange={(k) => set.mutate(k)} items={q.data!.items} version={accent} />}
      <p className="small muted" style={{ margin: 0 }}>콘텐츠마다 카드를 만들 때 다른 템플릿을 고를 수도 있습니다.</p>
    </section>
  );
}

function UploadTemplate({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useTemplates(cid);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState("classic");
  const [tone, setTone] = useState("dark");
  const [overlay, setOverlay] = useState(0);
  const [all, setAll] = useState(false);
  const up = useMutation({
    mutationFn: () => apiUpload<{ key: string }>(`/channels/${cid}/templates?name=${encodeURIComponent(name)}&layout=${layout}&tone=${tone}&overlay=${overlay}&allChannels=${all ? 1 : 0}`, file!),
    onSuccess: () => {
      toast("ok", "배경 템플릿을 추가했습니다. 위 목록에서 기본으로 고를 수 있습니다.");
      setFile(null);
      setName("");
      qc.invalidateQueries({ queryKey: ["ch", cid, "templates"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const customs = (q.data?.items ?? []).filter((t) => t.kind === "custom");
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>내 배경 템플릿</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Canva·망고보드·포토샵 등에서 <b>글자 없이 배경만</b> 1080×1350(4:5) 크기로 디자인해 PNG/JPG로 내려받은 뒤 올리세요. 제목·일정 같은 글자는 이 앱이 자동으로 얹습니다. 글자가 들어갈 가운데·왼쪽 영역은 비워 두면 잘 읽힙니다.
      </p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (file && name.trim()) up.mutate(); }}>
        <div className="grid grid-2">
          <label className="field">
            배경 이미지 (PNG·JPG·WEBP, 12MB 이하)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <label className="field">
            템플릿 이름
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 가을 파스텔" required />
          </label>
          <label className="field">
            글자 배치
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="classic">기본</option>
              <option value="magazine">매거진(강조 상자)</option>
              <option value="minimal">미니멀</option>
            </select>
          </label>
          <fieldset className="row">
            <legend>글자색</legend>
            <label className="check"><input type="radio" name="tone" checked={tone === "dark"} onChange={() => setTone("dark")} /> 어두운 글자(밝은 배경용)</label>
            <label className="check"><input type="radio" name="tone" checked={tone === "light"} onChange={() => setTone("light")} /> 흰 글자(어두운 배경용)</label>
          </fieldset>
        </div>
        <label className="field">
          가독성 막 {overlay}%
          <span className="hint">배경이 복잡해 글자가 잘 안 보이면 올리세요(흰 글자면 어둡게, 어두운 글자면 밝게 덮음).</span>
          <input type="range" min={0} max={80} step={5} value={overlay} onChange={(e) => setOverlay(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 모든 채널에서 사용
        </label>
        <div>
          <button className="btn primary" disabled={!file || !name.trim() || up.isPending}>
            {up.isPending ? "올리는 중…" : "템플릿 추가"}
          </button>
        </div>
      </form>
      {customs.length > 0 && (
        <div className="stack">
          <h3 style={{ margin: 0 }}>올린 템플릿</h3>
          {customs.map((t) => (
            <CustomRow key={t.key} cid={cid} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function CustomRow({ cid, t }: { cid: number; t: Tpl }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tone, setTone] = useState(t.textTone ?? "dark");
  const [overlay, setOverlay] = useState(t.overlay ?? 0);
  const [v, setV] = useState(0);
  const save = useMutation({
    mutationFn: () => api(`/channels/${cid}/templates/${t.id}`, { method: "PATCH", body: { textTone: tone, overlay } }),
    onSuccess: () => {
      setV((x) => x + 1);
      toast("ok", "템플릿을 수정했습니다.");
      qc.invalidateQueries({ queryKey: ["ch", cid, "templates"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/channels/${cid}/templates/${t.id}/delete`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast("ok", "템플릿을 삭제했습니다. 이미 만든 카드는 그대로 남습니다.");
      qc.invalidateQueries({ queryKey: ["ch", cid, "templates"] });
    },
  });
  return (
    <div className="list-item" style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
      <img src={`/api/channels/${cid}/templates/preview?size=sm&key=${t.key}&v=${v}`} alt={`${t.name} 미리보기`} style={{ width: 120, aspectRatio: "4/5", borderRadius: 8, objectFit: "cover" }} />
      <div className="stack" style={{ flex: 1, minWidth: 220 }}>
        <strong>
          {t.name} {t.allChannels && <Badge kind="">모든 채널</Badge>}
        </strong>
        <div className="row">
          <label className="check"><input type="radio" name={`tone-${t.id}`} checked={tone === "dark"} onChange={() => setTone("dark")} /> 어두운 글자</label>
          <label className="check"><input type="radio" name={`tone-${t.id}`} checked={tone === "light"} onChange={() => setTone("light")} /> 흰 글자</label>
        </div>
        <label className="field">
          가독성 막 {overlay}%
          <input type="range" min={0} max={80} step={5} value={overlay} onChange={(e) => setOverlay(Number(e.target.value))} />
        </label>
        <div className="row">
          <button className="btn sm primary" onClick={() => save.mutate()} disabled={save.isPending}>적용</button>
          <button className="btn sm danger" onClick={() => confirm(`'${t.name}' 템플릿을 삭제할까요?`) && del.mutate()}>삭제</button>
        </div>
      </div>
    </div>
  );
}

type CanvaStatus = { configured: boolean; connected: boolean; redirectUri: string; scopes: string[] };

function CanvaSection({ cid, brandTemplateId }: { cid: number; brandTemplateId: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({ queryKey: ["canva-status"], queryFn: () => api<CanvaStatus>("/canva/status") });
  const list = useQuery({ queryKey: ["canva-templates"], queryFn: () => api<{ items: Array<{ id: string; title: string; thumbnail?: { url: string } }> }>("/canva/brand-templates"), enabled: !!st.data?.connected, retry: false });
  const [manual, setManual] = useState(brandTemplateId ?? "");
  const tplId = brandTemplateId;
  const dataset = useQuery({ queryKey: ["canva-dataset", tplId], queryFn: () => api<{ dataset: Record<string, { type: string }> }>(`/canva/brand-templates/${encodeURIComponent(tplId!)}/dataset`), enabled: !!tplId && !!st.data?.connected, retry: false });
  const save = useMutation({
    mutationFn: (id: string | null) => api(`/channels/${cid}/design`, { method: "PUT", body: { canvaBrandTemplateId: id } }),
    onSuccess: () => {
      toast("ok", "Canva 브랜드 템플릿을 지정했습니다.");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const disconnect = useMutation({ mutationFn: () => api("/canva/disconnect", { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["canva-status"] }) });
  const ours = new Set(Object.values(CARD_FIELD_KEYS).flat().map((f) => f.key));
  const s = st.data;
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Canva 자동 채우기</h2>
        {s && <Badge kind={s.connected ? "ok" : "warn"}>{s.connected ? "Canva 연결됨" : s.configured ? "연결 전" : "앱 정보 필요"}</Badge>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Canva에서 만든 <b>브랜드 템플릿</b>의 글자 칸(데이터 필드)에 제목·일정 등을 자동으로 넣어 새 디자인을 만듭니다. 만든 디자인은 Canva에서 다듬은 뒤 버튼 하나로 카드 이미지로 가져옵니다. Canva Pro·Teams·Enterprise 계정이 필요합니다.
      </p>
      {!s ? (
        <Loading lines={1} />
      ) : !s.configured ? (
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <a href="https://www.canva.com/developers/apps" target="_blank" rel="noopener noreferrer">Canva 개발자 페이지(Your apps)</a>에서 앱을 만들고 <b>Outside Canva</b>(Connect API)를 켭니다.
          </li>
          <li>
            권한(Scopes)에서 <code>{s.scopes.join(", ")}</code>를 허용합니다.
          </li>
          <li>
            리디렉트 주소(Redirect URL)에 <code>{s.redirectUri}</code> 를 넣습니다.
          </li>
          <li>Client ID와 Client secret을 <b>채널 설정 → 서비스 연결 → Canva</b>에 저장한 뒤 이 화면으로 돌아옵니다.</li>
        </ol>
      ) : !s.connected ? (
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            Canva 앱의 리디렉트 주소가 <code>{s.redirectUri}</code> 인지 확인한 뒤 연결하세요.
          </p>
          <div>
            <a className="btn primary" href="/api/canva/connect">
              Canva 연결
            </a>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="row">
            <span className="small muted">템플릿 선택</span>
            <button className="btn sm ghost" onClick={() => disconnect.mutate()}>연결 해제</button>
          </div>
          {list.isLoading ? (
            <Loading lines={1} />
          ) : list.error ? (
            <ErrorBox error={list.error} />
          ) : list.data!.items.length ? (
            <div className="tpl-grid">
              {list.data!.items.map((t) => (
                <button key={t.id} type="button" className="tpl" aria-pressed={tplId === t.id} onClick={() => save.mutate(t.id)}>
                  {t.thumbnail?.url ? <img src={t.thumbnail.url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="tpl-desc">미리보기 없음</span>}
                  <span className="tpl-name">{t.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted">브랜드 템플릿이 없습니다. Canva에서 디자인을 브랜드 템플릿으로 게시하세요.</p>
          )}
          <form className="row" onSubmit={(e) => { e.preventDefault(); save.mutate(manual.trim() || null); }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="또는 브랜드 템플릿 ID 직접 입력" style={{ flex: "1 1 240px", width: "auto" }} aria-label="브랜드 템플릿 ID" />
            <button className="btn sm">지정</button>
          </form>
          {tplId && dataset.data && (
            <div className="stack">
              <span className="small">템플릿의 글자 칸과 콘텐츠 항목 연결</span>
              <div className="row">
                {Object.entries(dataset.data.dataset).map(([k, v]) => (
                  <Badge key={k} kind={v.type === "text" && ours.has(k) ? "ok" : "warn"}>
                    {k} {v.type !== "text" ? `(${v.type} — 자동 채우기 안 함)` : ours.has(k) ? "✓" : "— 이름이 달라 비워 둠"}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {dataset.error && <ErrorBox error={dataset.error} />}
        </div>
      )}
    </section>
  );
}

function BulkSection({ cid, kind }: { cid: number; kind: string }) {
  const keys = CARD_FIELD_KEYS[kind] ?? CARD_FIELD_KEYS.notice;
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>Canva 대량 제작 · 망고보드용 글자 내보내기</h2>
      <p className="small muted" style={{ margin: 0 }}>
        API 연결 없이도 쓸 수 있는 방법입니다. <b>Canva 대량 제작(Bulk Create, Pro 이상·데스크톱)</b>은 CSV 파일을 올리면 템플릿의 글자 칸을 행마다 채워 여러 장을 한 번에 만듭니다. 망고보드는 공개 API·대량 제작 기능을 확인하지 못해, 콘텐츠 상세 화면의 <b>글자 복사</b>로 붙여 넣는 방식을 권합니다.
      </p>
      <table className="simple">
        <thead>
          <tr>
            <th>CSV 열 이름</th>
            <th>들어가는 내용</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.key}>
              <td><code>{k.key}</code></td>
              <td>{k.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <a className="btn" href={`/api/channels/${cid}/export/fields.csv`}>
          검토 완료 항목 CSV 내려받기
        </a>
        <span className="small muted">Canva 템플릿의 글자 칸 이름을 위 열 이름과 같게 연결하세요.</span>
      </div>
    </section>
  );
}

