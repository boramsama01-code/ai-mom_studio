import { lazy, Suspense, useState } from "react";
import { useLocation } from "wouter";
import { creativeProfileFor } from "@shared/creativeProfile";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import { Icon } from "../icons";
const Design = lazy(() => import("./Design").then(m => ({ default: m.DesignPage })));
const Characters = lazy(() => import("./StudioPosePicker").then(m => ({ default: m.StudioCharacterArchive })));
export function AssetsPage() {
  const { channels, selected, current, error, refresh } = useChannel();
  const guard = useDirtyGuard(), [, navigate] = useLocation();
  const [tab, setTab] = useState(() => ["templates","characters","brands"].includes(new URLSearchParams(location.search).get("tab") ?? "") ? new URLSearchParams(location.search).get("tab")! : "templates");
  const change = (value: string) => guard.confirmLeave(() => { setTab(value); navigate(`/assets?tab=${value}`, { replace: true }); });
  return <div className="asset-workspace"><header className="page-head"><div><span className="section-kicker">CREATIVE LIBRARY</span><h1>자산·템플릿</h1><p className="muted">선택할 디자인과 승인된 캐릭터를 한곳에서.</p></div><span className="asset-scope"><Icon name="channels" size={16}/>{current?.name ?? "모든 채널"}</span></header>
    <nav className="asset-tabs" aria-label="자산 종류">{[["templates","디자인 템플릿"],["characters","캐릭터·포즈"],["brands","브랜드 가이드"]].map(([key,label]) => <button className="btn ghost" key={key} aria-pressed={tab === key} onClick={() => change(key)}>{label}</button>)}</nav>
    {error && <ErrorBox error={error} retry={refresh}/>}
    <Suspense fallback={<Loading label="자산 불러오는 중" lines={5}/>}>
      {tab === "templates" && <div className="asset-template-content"><Design embedded/></div>}
      {tab === "characters" && <Characters/>}
      {tab === "brands" && <div className="asset-brand-grid">{channels.filter(channel => selected === "all" || channel.id === selected).map(channel => { const profile = creativeProfileFor(channel); return <article className="asset-brand" key={channel.id}>
        <div className="asset-brand-art" style={{ backgroundColor: channel.accentColor + "12" }}>{profile.logoUrl ? <img src={profile.logoUrl} alt={`${channel.name} 등록 로고`}/> : channel.slug === "penguin" ? <img src="/branding/space-penguin-company.svg" alt="우주펭귄상회 로고"/> : <span style={{ color: channel.accentColor }}>{channel.name}</span>}</div>
        <div className="asset-brand-copy"><h2>{channel.name}</h2><span className="asset-version">채널 설정 v{channel.version}</span><p>{channel.description || "브랜드 설명을 추가해 주세요."}</p><dl><div><dt>대상</dt><dd>{channel.audience}</dd></div><div><dt>색상</dt><dd><i style={{ backgroundColor: channel.accentColor }}/>{channel.accentColor}</dd></div><div><dt>서체 가이드</dt><dd>{profile.font}</dd></div><div><dt>말투</dt><dd>{profile.tone || "채널 편집 기준 사용"}</dd></div><div><dt>자산 기준</dt><dd>{profile.assetGuide || "채널 설정에서 승인 자산의 기준을 기록하세요."}</dd></div></dl><GuardedLink className="btn" href={`/settings?channel=${channel.id}`}>브랜드 설정 <Icon name="arrow" size={16}/></GuardedLink></div>
      </article>; })}</div>}
    </Suspense>
  </div>;
}
