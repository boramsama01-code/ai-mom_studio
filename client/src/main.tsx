import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, Switch, useLocation, Redirect } from "wouter";
import "./styles.css";
import { api } from "./api";
import { ChannelProvider, DirtyGuardProvider, useChannel, useMe } from "./state";
import { DirtyModal, ErrorBox, GuardedLink, Loading } from "./ui";
import { LoginPage } from "./pages/Login";
import { TodayPage } from "./pages/Today";
import { InboxPage } from "./pages/Inbox";
import { ItemDetailPage } from "./pages/ItemDetail";
import { DraftsPage } from "./pages/Drafts";
import { RulesPage } from "./pages/Rules";
import { PublishPage } from "./pages/Publish";
import { ChannelSettingsPage } from "./pages/ChannelSettings";
import { RunsPage } from "./pages/Runs";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const NAV = [
  { href: "/", label: "오늘의 작업" },
  { href: "/inbox", label: "수집함" },
  { href: "/drafts", label: "콘텐츠 초안" },
  { href: "/rules", label: "검색 설정" },
  { href: "/publish", label: "발행함" },
  { href: "/settings", label: "채널 설정" },
  { href: "/runs", label: "실행 기록" },
];

function ChannelSelect({ id }: { id: string }) {
  const { channels, selected, select } = useChannel();
  return (
    <label className="field">
      <span className="small muted">현재 채널</span>
      <select id={id} value={String(selected)} onChange={(e) => select(e.target.value === "all" ? "all" : Number(e.target.value))}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.active ? "" : " (비활성)"}
          </option>
        ))}
        <option value="all">전체 (조회 전용)</option>
      </select>
    </label>
  );
}

function Shell() {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const { current, selected } = useChannel();
  const me = useMe();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<{ globalStop: boolean }>("/status"), refetchInterval: 60_000 });
  const isActive = (href: string) => (href === "/" ? loc === "/" : loc.startsWith(href) || (href === "/inbox" && loc.startsWith("/items")));
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    location.href = "/";
  };
  const channelLabel = selected === "all" ? "전체 채널 (조회 전용)" : current?.name ?? "";
  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}>
          ☰
        </button>
        <span className="grow">
          <span className="dot" style={{ background: current?.accentColor ?? "#586579", marginRight: 6 }} aria-hidden />
          {channelLabel}
        </span>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="주 메뉴">
        <div className="row between">
          <div className="brand">
            아이맘 스튜디오
            <small>ai-mom · 운영 관리</small>
          </div>
          <button className="btn ghost only-mobile" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <ChannelSelect id="channel-select" />
        <nav className="nav">
          {NAV.map((n) => (
            <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)} onClick={() => setOpen(false)}>
              {n.label}
            </GuardedLink>
          ))}
        </nav>
        <div style={{ marginTop: "auto" }} className="stack small">
          {status.data?.globalStop && <span className="badge err">전역 정지 중</span>}
          {me.data?.demo && <span className="badge sample">샘플 모드 · 실제 정보 아님</span>}
          <span className="muted">로그인: {me.data?.user}</span>
          <button className="btn sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>
      <main className="main" id="main">
        <Switch>
          <Route path="/" component={TodayPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/items/:cid/:id">{(p) => <ItemDetailPage cid={Number(p.cid)} id={Number(p.id)} />}</Route>
          <Route path="/drafts" component={DraftsPage} />
          <Route path="/rules" component={RulesPage} />
          <Route path="/publish" component={PublishPage} />
          <Route path="/settings" component={ChannelSettingsPage} />
          <Route path="/runs" component={RunsPage} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </main>
      <DirtyModal />
    </div>
  );
}

function Root() {
  const me = useMe();
  if (me.isLoading) return <div className="main"><Loading /></div>;
  if (me.error) return <div className="main"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;
  if (!me.data?.user) return <LoginPage me={me.data!} />;
  return (
    <DirtyGuardProvider>
      <ChannelProvider>
        <Shell />
      </ChannelProvider>
    </DirtyGuardProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
