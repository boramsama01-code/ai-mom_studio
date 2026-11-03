import { lazy, Suspense, StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, Switch, useLocation, Redirect } from "wouter";
import "./styles.css";
import "./studio.css";
import "./design-system.css";
import "./channel-navigation.css";
import "./contentWorkspace.css";
import { Icon, type IconName } from "./icons";
import { useFocusScope } from "./useFocusScope";
import { api } from "./api";
import { ChannelProvider, DirtyGuardProvider, useChannel, useDirtyGuard, useMe } from "./state";
import { GuardedRouter } from "./GuardedRouter";
import { DirtyModal, ErrorBox, GuardedLink, Loading } from "./ui";
import { ToastProvider, useToast } from "./toast";
import { CommandPalette } from "./palette";
import { GlobalChannelSelect } from "./GlobalChannelSelect";
import { ScreenErrorBoundary } from "./ScreenErrorBoundary";
import { LoginPage } from "./pages/Login";
import { AccountPage, PasswordSetupPage } from "./pages/Password";
const TodayPage = lazy(() => import("./pages/Today").then(m => ({ default: m.TodayPage })));
const InboxPage = lazy(() => import("./pages/Inbox").then(m => ({ default: m.InboxPage })));
const ItemDetailPage = lazy(() => import("./pages/ItemDetail").then(m => ({ default: m.ItemDetailPage })));
const RulesPage = lazy(() => import("./pages/Rules").then(m => ({ default: m.RulesPage })));
const PublishPage = lazy(() => import("./pages/Publish").then(m => ({ default: m.PublishPage })));
const ChannelSettingsPage = lazy(() => import("./pages/ChannelSettings").then(m => ({ default: m.ChannelSettingsPage })));
const ConnectionsPage = lazy(() => import("./pages/Connections").then(m => ({ default: m.ConnectionsPage })));
const InstagramConnectionsPage = lazy(() => import("./pages/InstagramConnections").then(m => ({ default: m.InstagramConnectionsPage })));
const RunsPage = lazy(() => import("./pages/Runs").then(m => ({ default: m.RunsPage })));
const DesignPage = lazy(() => import("./pages/Design").then(m => ({ default: m.DesignPage })));
const StudioPage = lazy(() => import("./pages/Studio").then(m => ({ default: m.StudioPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const NAV: Array<{ group: string; collapsible?: boolean; items: Array<{ href: string; label: string; icon: IconName; count?: "review" }> }> = [
  {
    group: "스튜디오",
    items: [
      { href: "/", label: "내 콘텐츠", icon: "grid" },
      { href: "/inbox", label: "수집함", icon: "inbox", count: "review" },
      { href: "/publish", label: "발행함", icon: "send" },
    ],
  },
  {
    group: "더 보기",
    collapsible: true,
    items: [
      { href: "/today", label: "아침 수집 브리핑", icon: "sun" },
    ],
  },
  {
    group: "설정",
    collapsible: true,
    items: [
      { href: "/instagram", label: "인스타그램 연결", icon: "link" },
      { href: "/rules", label: "검색 설정", icon: "sliders" },
      { href: "/design", label: "수집 카드 디자인", icon: "design" },
      { href: "/connections", label: "API 키 관리", icon: "link" },
      { href: "/settings", label: "채널 설정", icon: "channels" },
      { href: "/account", label: "계정·비밀번호", icon: "lock" },
      { href: "/runs", label: "실행 기록", icon: "clock" },
    ],
  },
];

function NavigationGroup({ title, collapsible, expanded, children }: { title: string; collapsible?: boolean; expanded: boolean; children: ReactNode }) {
  return collapsible ? <details className="nav-group nav-settings" open={expanded}><summary className="nav-group-label">{title}<Icon name="chevron" size={14} /></summary>{children}</details> : <div className="nav-group"><div className="nav-group-label">{title}</div>{children}</div>;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Shell() {
  const [loc] = useLocation();
  const guard = useDirtyGuard();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  useFocusScope(sidebar, open, () => setOpen(false));
  useEffect(() => { setOpen(false); }, [loc]);
  const { selected } = useChannel();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<{ globalStop: boolean }>("/status"), refetchInterval: 60_000 });
  const today = useQuery({
    queryKey: ["ch", selected, "today"],
    queryFn: () => api<{ counts: { pendingReview: number } }>(`/channels/${selected}/today`),
    enabled: selected !== "all",
    refetchInterval: 120_000,
  });
  const inStudio = loc === "/" || loc.startsWith("/studio");
  const editingContent = /^\/(?:studio\/\d+|items\/\d+\/\d+)\/?$/.test(loc);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOpen(window.innerHeight - viewport.height > 150);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  const isActive = (href: string) => (href === "/" ? inStudio : loc.startsWith(href) || (href === "/inbox" && loc.startsWith("/items")));
  const logout = () => guard.confirmLeave(() => {
    void api("/auth/logout", { method: "POST" }).then(() => {
      qc.clear();
      location.href = "/";
    }).catch(error => toast("err", (error as Error).message));
  });
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
  return (
    <div className={`shell${editingContent ? " is-content-editor" : ""}${keyboardOpen ? " keyboard-open" : ""}`}>
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
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
        <nav className="nav">
          {NAV.map((g) => (
            <NavigationGroup key={g.group} title={g.group} collapsible={g.collapsible} expanded={g.items.some(n => isActive(n.href))}>
              {g.items.map((n) => {
                const c = n.count === "review" ? counts?.pendingReview : undefined;
                return (
                  <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)} onClick={() => setOpen(false)}>
                    <span className="nav-icon" aria-hidden>
                      <Icon name={n.icon} size={19} />
                    </span>
                    <span className="grow">{n.label}</span>
                    {!!c && <span className="nav-count" aria-label={`검토 대기 ${c}건`} title={`검토 대기 ${c}건`}>{c}</span>}
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
      <header className="workspace-bar workspace-header">
        <div className="workspace-header-left">
          <button className="btn ghost icon only-mobile" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="workspace-breadcrumb"><span>우주펭귄상회</span><Icon name="chevron" size={14} /><strong>{activeNav?.label ?? "작업실"}</strong></div>
        </div>
        <div className="workspace-bar-right">
          <button className="btn ghost icon workspace-search" aria-label="검색·이동" onClick={() => setPalette(true)}><Icon name="search" size={18} /></button>
          <GlobalChannelSelect />
        </div>
      </header>
      <main className="main" id="main" tabIndex={-1} data-section={sectionName}>
        <ScreenErrorBoundary key={loc} onReload={() => guard.confirmLeave(() => window.location.reload())}>
        <Suspense fallback={<Loading label="화면 불러오는 중" />}><Switch>
          <Route path="/"><StudioPage /></Route>
          <Route path="/studio/:id">{(p) => <StudioPage cardId={Number(p.id)} />}</Route>
          <Route path="/today" component={TodayPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/items/:cid/:id">{(p) => <ItemDetailPage cid={Number(p.cid)} id={Number(p.id)} />}</Route>
          <Route path="/drafts"><Redirect to="/" replace /></Route>
          <Route path="/rules" component={RulesPage} />
          <Route path="/design" component={DesignPage} />
          <Route path="/publish" component={PublishPage} />
          <Route path="/settings" component={ChannelSettingsPage} />
          <Route path="/connections" component={ConnectionsPage} />
          <Route path="/instagram" component={InstagramConnectionsPage} />
          <Route path="/account" component={AccountPage} />
          <Route path="/runs" component={RunsPage} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch></Suspense>
        </ScreenErrorBoundary>
      </main>
      </div>
      <nav className="mobile-nav" aria-label="빠른 메뉴">{NAV.flatMap(g => g.items).filter(n => ["/", "/inbox", "/publish"].includes(n.href)).map(n => <GuardedLink key={n.href} href={n.href} ariaCurrent={isActive(n.href)}><Icon name={n.icon} size={20} /><span>{n.label}</span></GuardedLink>)}<button aria-label="전체 메뉴 열기" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" size={20} /><span>전체 메뉴</span></button></nav>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onCollect={collect} />
      <DirtyModal />
    </div>
  );
}

function Root() {
  const [loc] = useLocation();
  if (loc === "/password-setup") return <PasswordSetupPage />;
  return <AuthenticatedRoot />;
}

function AuthenticatedRoot() {
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
    <ChannelProvider>
      <Shell />
    </ChannelProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DirtyGuardProvider><GuardedRouter><Root /></GuardedRouter></DirtyGuardProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
