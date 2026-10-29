import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, WalletCards } from "lucide-react";
import Ledger from "./Ledger";

type Session = { authenticated: boolean; setupRequired: boolean; user?: { name: string; username: string } };
async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok || !data) throw new Error(data?.error || "요청을 완료하지 못했습니다. 다시 시도해 주세요.");
  return data as T;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialError, setInitialError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [setupKey, setSetupKey] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("setup") || "");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("setup")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal }).then(readJson<Session>).then(setSession).catch(e => { if (e.name !== "AbortError") setInitialError(e.message); });
    return () => controller.abort();
  }, []);
  async function refreshSession() {
    const next = await readJson<Session>(await fetch("/api/session", { cache: "no-store" }));
    setSession(next); setPassword(""); setConfirm(""); setError("");
    if (next.authenticated) setSetupKey("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return; setError("");
    const setup = !!session?.setupRequired;
    if (setup && password !== confirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (setup && password.length < 12) { setError("비밀번호는 12자 이상 입력해 주세요."); return; }
    busyRef.current = true; setBusy(true);
    try {
      await readJson(await fetch(setup ? "/api/setup" : "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup ? { setupKey, username: username.trim(), password, name: name.trim() } : { username: username.trim(), password }) }));
      await refreshSession();
    } catch (e) { setError(e instanceof Error ? e.message : "로그인하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await readJson(await fetch("/api/logout", { method: "POST" })); await refreshSession(); }
    catch (e) { setError(e instanceof Error ? e.message : "로그아웃하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (session?.authenticated) return <><Ledger userName={session.user?.name || session.user?.username || "나"} onLogout={logout} logoutBusy={busy}/>{error && <div className="auth-error-toast" role="alert">{error}<button onClick={() => setError("")}>닫기</button></div>}</>;

  return <main className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><WalletCards size={24} strokeWidth={1.8}/></span><h1>가계부</h1></div>
    {!session ? initialError ? <div className="auth-unavailable" role="alert"><p>{initialError}</p><button className="button secondary" onClick={() => window.location.reload()}>새로고침</button></div> : <div className="auth-unavailable" role="status"><LoaderCircle className="spin" size={24}/><span>불러오는 중</span></div> : session.setupRequired && !setupKey ? <div className="auth-unavailable"><h2>초기 설정이 필요합니다</h2><p>초기 설정 링크로 접속해 주세요.</p></div> : <>
      <div className="auth-title"><h2>{session.setupRequired ? "관리자 계정 만들기" : "로그인"}</h2></div>
      <form onSubmit={submit} className="auth-form"><fieldset disabled={busy}>
        {session.setupRequired && <label className="field">이름<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={40} placeholder="이름"/></label>}
        <label className="field">아이디<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" required placeholder={session.setupRequired ? "영문·숫자 3~40자" : "아이디"}/></label>
        <label className="field">비밀번호<span className="password-input"><input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? "text" : "password"} autoComplete={session.setupRequired ? "new-password" : "current-password"} minLength={session.setupRequired ? 12 : 1} maxLength={128} required placeholder={session.setupRequired ? "12자 이상" : "비밀번호"}/><button className="icon-button" type="button" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
        {session.setupRequired && <label className="field">비밀번호 확인<input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="비밀번호 다시 입력"/></label>}
      </fieldset>{error && <div className="error-message" role="alert">{error}</div>}<button type="submit" className="button primary auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{busy ? "처리 중…" : session.setupRequired ? "계정 만들기" : "로그인"}{!busy && <ArrowRight size={18}/>}</button></form>
    </>}
  </div></main>;
}
