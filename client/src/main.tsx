import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, Switch, useLocation, Redirect } from "wouter";
import "./styles.css";
import { api } from "./api";
import { ChannelProvider, DirtyGuardProvider, useChannel, useMe } from "./state";
import { DirtyModal, ErrorBox, GuardedLink, Loading } from "./ui";
import { ToastProvider, useToast } from "./toast";
import { CommandPalette } from "./palette";
import { LoginPage } from "./pages/Login";
import { TodayPage } from "./pages/Today";
import { InboxPage } from "./pages/Inbox";
import { ItemDetailPage } from "./pages/ItemDetail";
import { DraftsPage } from "./pages/Drafts";
import { RulesPage } from "./pages/Rules";
import { PublishPage } from "./pages/Publish";
import { ChannelSettingsPage } from "./pages/ChannelSettings";
import { RunsPage } from "./pages/Runs";
import { DesignPage } from "./pages/Design";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: string; count?: "review" | "ready" }> }> = [
  {
    group: "작업",
    items: [
      { href: "/", label: "오늘의 작업", icon: "◎" },
      { href: "/inbox", label: "수집함", icon: "▤", count: "review" },
      { href: "/drafts", label: "콘텐츠 초안", icon: "✎", count: "ready" },
      { href: "/publish", label: "발행함", icon: "➤" },
    ],
  },
  {
    group: "설정",
    items: [
      { href: "/rules", label: "검색 설정", icon: "⌕" },
      { href: "/design", label: "카드 디자인", icon: "▣" },
      { href: "/settings", label: "채널 설정·연결", icon: "⚙" },
      { href: "/runs", label: "실행 기록", icon: "≡" },
    ],
  },
];

function ChannelSelect({ id }: { id: string }) {
  const { channels, selected, select } = useChannel();
  return (
    <label className="field channel-select">
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

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Shell() {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const { current, selected } = useChannel();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<{ globalStop: boolean }>("/status"), refetchInterval: 60_000 });
  const today = useQuery({
    queryKey: ["ch", selected, "today"],
    queryFn: () => api<{ counts: { pendingReview: number; draftsReady: number } }>(`/channels/${selected}/today`),
    enabled: selected !== "all",
    refetchInterval: 120_000,
  });
  const isActive = (href: string) => (href === "/" ? loc === "/" : loc.startsWith(href) || (href === "/inbox" && loc.startsWith("/items")));
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    location.href = "/";
  };
  const collect = useCallback(async () => {
    if (selected === "all") return toast("err", "수집은 채널을 하나 고른 뒤 요청할 수 있습니다.");
    try {
      const r = await api<{ duplicate: boolean }>(`/channels/${selected}/jobs/collect`, { method: "POST", body: {} });
      toast("ok", r.duplicate ? "이미 대기 중인 수집 요청이 있습니다." : "수집 요청을 등록했습니다. 워커 실행 때 처리됩니다.");
      qc.invalidateQueries({ queryKey: ["ch", selected] });
    } catch (e) {
      toast("err", (e as Error).message);
    }
  }, [selected, toast, qc]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // Canva 연결 결과 안내(리디렉트 후)
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const c = p.get("canva");
    if (c === "connected") toast("ok", "Canva 계정을 연결했습니다.");
    else if (c === "error") toast("err", `Canva 연결 실패: ${p.get("reason") ?? ""}`);
    if (c) history.replaceState(null, "", location.pathname);
  }, [toast]);

  const counts = today.data?.counts;
  const channelLabel = selected === "all" ? "전체 채널 (조회 전용)" : current?.name ?? "";
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <button className="btn ghost icon" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}>
          ☰
        </button>
        <span className="grow">
          <span className="dot" style={{ background: current?.accentColor ?? "#586579", marginRight: 6 }} aria-hidden />
          {channelLabel}
        </span>
        <button className="btn ghost icon" aria-label="검색·이동" onClick={() => setPalette(true)}>
          ⌕
        </button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="주 메뉴">
        <div className="row between">
          <div className="brand">
            <img className="brand-penguin" src="/favicon.svg" alt="" width="40" height="40" />
            <span>
              우주펭귄상회
              <small>스튜디오 · 운영 관리</small>
            </span>
          </div>
          <button className="btn ghost icon only-mobile" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <button className="palette-trigger" onClick={() => setPalette(true)}>
          <span>검색·이동</span>
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <ChannelSelect id="channel-select" />
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((n) => {
                const c = n.count === "review" ? counts?.pendingReview : n.count === "ready" ? counts?.draftsReady : undefined;
                return (
                  <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)} onClick={() => setOpen(false)}>
                    <span className="nav-icon" aria-hidden>
                      {n.icon}
                    </span>
                    <span className="grow">{n.label}</span>
                    {!!c && <span className="nav-count" aria-label={`${c}건`}>{c}</span>}
                  </GuardedLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: "auto" }} className="stack small">
          {status.data?.globalStop && <span className="badge err">전역 정지 중</span>}
          {me.data?.demo && <span className="badge sample">샘플 모드 · 실제 정보 아님</span>}
          <div className="row between">
            <span className="muted">{me.data?.user}</span>
            <button className="btn sm ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <Switch>
          <Route path="/" component={TodayPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/items/:cid/:id">{(p) => <ItemDetailPage cid={Number(p.cid)} id={Number(p.id)} />}</Route>
          <Route path="/drafts" component={DraftsPage} />
          <Route path="/rules" component={RulesPage} />
          <Route path="/design" component={DesignPage} />
          <Route path="/publish" component={PublishPage} />
          <Route path="/settings" component={ChannelSettingsPage} />
          <Route path="/runs" component={RunsPage} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onCollect={collect} />
      <DirtyModal />
    </div>
  );
}

function Root() {
  const me = useMe();
  if (me.isLoading)
    return (
      <div className="main">
        <Loading />
      </div>
    );
  if (me.error)
    return (
      <div className="main">
        <ErrorBox error={me.error} retry={() => me.refetch()} />
      </div>
    );
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
      <ToastProvider>
        <Root />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

