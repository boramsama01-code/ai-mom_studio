import { lazy, Suspense, StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, Switch, useLocation, Redirect } from "wouter";
import "./styles.css";
import "./studio.css";
import "./design-system.css";
import { Icon, type IconName } from "./icons";
import { useFocusScope } from "./useFocusScope";
import { api } from "./api";
import { ChannelProvider, DirtyGuardProvider, useChannel, useMe } from "./state";
import { DirtyModal, ErrorBox, GuardedLink, Loading } from "./ui";
import { ToastProvider, useToast } from "./toast";
import { CommandPalette } from "./palette";
import { LoginPage } from "./pages/Login";
const TodayPage = lazy(() => import("./pages/Today").then(m => ({ default: m.TodayPage })));
const InboxPage = lazy(() => import("./pages/Inbox").then(m => ({ default: m.InboxPage })));
const ItemDetailPage = lazy(() => import("./pages/ItemDetail").then(m => ({ default: m.ItemDetailPage })));
const DraftsPage = lazy(() => import("./pages/Drafts").then(m => ({ default: m.DraftsPage })));
const RulesPage = lazy(() => import("./pages/Rules").then(m => ({ default: m.RulesPage })));
const PublishPage = lazy(() => import("./pages/Publish").then(m => ({ default: m.PublishPage })));
const ChannelSettingsPage = lazy(() => import("./pages/ChannelSettings").then(m => ({ default: m.ChannelSettingsPage })));
const ConnectionsPage = lazy(() => import("./pages/Connections").then(m => ({ default: m.ConnectionsPage })));
const RunsPage = lazy(() => import("./pages/Runs").then(m => ({ default: m.RunsPage })));
const DesignPage = lazy(() => import("./pages/Design").then(m => ({ default: m.DesignPage })));
const StudioPage = lazy(() => import("./pages/Studio").then(m => ({ default: m.StudioPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: IconName; count?: "review" | "ready" }> }> = [
  {
    group: "스튜디오",
    items: [{ href: "/", label: "내 콘텐츠", icon: "grid" }],
  },
  {
    group: "자료 수집 · 발행",
    items: [
      { href: "/today", label: "아침 수집 브리핑", icon: "sun" },
      { href: "/inbox", label: "수집함", icon: "inbox", count: "review" },
      { href: "/drafts", label: "콘텐츠 초안", icon: "pen", count: "ready" },
      { href: "/publish", label: "발행함", icon: "send" },
    ],
  },
  {
    group: "설정",
    items: [
      { href: "/rules", label: "검색 설정", icon: "sliders" },
      { href: "/design", label: "수집 카드 디자인", icon: "design" },
      { href: "/connections", label: "API 키 관리", icon: "link" },
      { href: "/settings", label: "채널 설정", icon: "channels" },
      { href: "/runs", label: "실행 기록", icon: "clock" },
    ],
  },
];

function NavigationGroup({ title, expanded, children }: { title: string; expanded: boolean; children: ReactNode }) {
  return title === "설정" ? <details className="nav-group nav-settings" open={expanded}><summary className="nav-group-label">설정<Icon name="chevron" size={14} /></summary>{children}</details> : <div className="nav-group"><div className="nav-group-label">{title}</div>{children}</div>;
}

function ChannelSelect({ id }: { id: string }) {
  const { channels, selected, select } = useChannel();
  return (
    <label className="field channel-select">
      <span className="small muted">채널</span>
      <select id={id} value={String(selected)} onChange={(e) => select(e.target.value === "all" ? "all" : Number(e.target.value))}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.active ? "" : " (비활성)"}
          </option>
        ))}
        <option value="all">모든 채널</option>
      </select>
    </label>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Shell() {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  useFocusScope(sidebar, open, () => setOpen(false));
  useEffect(() => { setOpen(false); }, [loc]);
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
  const inStudio = loc === "/" || loc.startsWith("/studio");
  const isActive = (href: string) => (href === "/" ? inStudio : loc.startsWith(href) || (href === "/inbox" && loc.startsWith("/items")));
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    location.href = "/";
  };
  const collect = useCallback(async () => {
    try {
      const r = await api<{ inline: boolean }>("/collection/collect", { method: "POST", body: { channelId: selected } });
      toast("ok", r.inline ? "자료 수집을 시작했습니다. 아침 수집 브리핑에서 결과를 확인하세요." : "수집 요청을 등록했습니다. 워커 실행을 기다립니다.");
      qc.invalidateQueries({ queryKey: ["ch", selected] });
      qc.invalidateQueries({ queryKey: ["collection"] });
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
  const activeNav = NAV.flatMap(g => g.items).find(n => isActive(n.href));
  const sectionName = NAV.find(g => g.items.some(n => isActive(n.href)))?.group ?? "스튜디오";
  const channelLabel = inStudio ? "우주펭귄상회 · Studio" : selected === "all" ? "전체 채널 (조회 전용)" : current?.name ?? "";
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <button className="btn ghost icon" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
        <span className="grow">
          <span className="dot" style={{ background: current?.accentColor ?? "#586579", marginRight: 6 }} aria-hidden />
          {channelLabel}
        </span>
        <button className="btn ghost icon" aria-label="검색·이동" onClick={() => setPalette(true)}>
          <Icon name="search" />
        </button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside ref={sidebar} className={`sidebar ${open ? "open" : ""}`} aria-label="주 메뉴" role={open ? "dialog" : undefined} aria-modal={open || undefined}>
        <div className="row between">
          <div className="brand">
            <img className="brand-penguin" src="/favicon.svg?v=20261018-2" alt="" width="40" height="40" />
            <span>
              우주펭귄상회
              <small>SPACE PENGUIN STUDIO</small>
            </span>
          </div>
          <button className="btn ghost icon only-mobile" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <button className="palette-trigger" onClick={() => { setOpen(false); setPalette(true); }}>
          <span className="row"><Icon name="search" size={17} /> 빠른 이동</span>
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        {!inStudio && <ChannelSelect id="channel-select" />}
        <nav className="nav">
          {NAV.map((g) => (
            <NavigationGroup key={g.group} title={g.group} expanded={g.items.some(n => isActive(n.href))}>
              {g.items.map((n) => {
                const c = n.count === "review" ? counts?.pendingReview : n.count === "ready" ? counts?.draftsReady : undefined;
                return (
                  <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)} onClick={() => setOpen(false)}>
                    <span className="nav-icon" aria-hidden>
                      <Icon name={n.icon} size={19} />
                    </span>
                    <span className="grow">{n.label}</span>
                    {!!c && <span className="nav-count" aria-label={`${c}건`}>{c}</span>}
                  </GuardedLink>
                );
              })}
            </NavigationGroup>
          ))}
        </nav>
        <div className="sidebar-account stack small">
          {status.data?.globalStop && <span className="badge err">전역 정지 중</span>}
          {me.data?.demo && <span className="badge sample">샘플 모드 · 실제 정보 아님</span>}
          <div className="row between">
            <span className="account-name"><span className="account-avatar" aria-hidden="true">{me.data?.user?.slice(0, 1).toUpperCase()}</span>{me.data?.user}</span>
            <button className="btn sm ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
      <header className="workspace-bar"><div className="workspace-breadcrumb"><span>우주펭귄상회</span><Icon name="chevron" size={14} /><strong>{activeNav?.label ?? "작업실"}</strong></div><div className="workspace-bar-right"><span className="workspace-private"><Icon name="check" size={14} /> 나의 작업 공간</span><button className="btn ghost icon" aria-label="검색·이동" onClick={() => setPalette(true)}><Icon name="search" size={18} /></button></div></header>
      <main className="main" id="main" tabIndex={-1} data-section={sectionName}>
        <Suspense fallback={<Loading label="화면 불러오는 중" />}><Switch>
          <Route path="/"><StudioPage /></Route>
          <Route path="/studio/:id">{(p) => <StudioPage cardId={Number(p.id)} />}</Route>
          <Route path="/today" component={TodayPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/items/:cid/:id">{(p) => <ItemDetailPage cid={Number(p.cid)} id={Number(p.id)} />}</Route>
          <Route path="/drafts" component={DraftsPage} />
          <Route path="/rules" component={RulesPage} />
          <Route path="/design" component={DesignPage} />
          <Route path="/publish" component={PublishPage} />
          <Route path="/settings" component={ChannelSettingsPage} />
          <Route path="/connections" component={ConnectionsPage} />
          <Route path="/runs" component={RunsPage} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch></Suspense>
      </main>
      </div>
      <nav className="mobile-nav" aria-label="빠른 메뉴">{NAV.flatMap(g => g.items).filter(n => ["/", "/inbox", "/drafts"].includes(n.href)).map(n => <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)}><Icon name={n.icon} size={20} /><span>{n.label}</span></GuardedLink>)}<button aria-label="전체 메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" size={20} /><span>전체 메뉴</span></button></nav>
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



