import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, setCsrf } from "../api";
import { useMe } from "../state";
import { forgetPasswordResetToken, passwordResetToken } from "../passwordReset";
import { passwordError } from "@shared/password";

export function PasswordForm({ username, resetToken }: { username: string; resetToken?: string }) {
  const [currentPassword, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const repeat = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const invalid = passwordError(password);
    if (invalid) { setError(invalid); first.current?.focus(); return; }
    if (password !== confirmation) { setError("새 비밀번호가 서로 일치하지 않습니다."); repeat.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      await api(resetToken ? "/auth/password-reset" : "/auth/password", { method: "POST", body: resetToken ? { token: resetToken, password } : { currentPassword, password } });
      setPassword(""); setConfirmation(""); setCurrent("");
      setCsrf(null); forgetPasswordResetToken(); setDone(true);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  if (done) return <div className="password-success stack" role="status"><span className="password-success-mark" aria-hidden="true">✓</span><h2>비밀번호를 저장했습니다</h2><p>아이디 <strong>{username}</strong>과 방금 정한 비밀번호로 로그인해 주세요.</p><a className="btn primary" href="/">로그인하기</a></div>;
  return <form className="stack password-form" onSubmit={submit}>
    <label className="field">아이디<input autoComplete="username" value={username} readOnly className="password-username" /></label>
    {!resetToken && <label className="field">현재 비밀번호<input type={visible ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={e => setCurrent(e.target.value)} required disabled={busy} /></label>}
    <label className="field">새 비밀번호<input ref={first} type={visible ? "text" : "password"} autoComplete="new-password" aria-describedby="password-help" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} maxLength={72} /></label>
    <p className="small muted password-help" id="password-help">12자 이상으로 정해 주세요. 기억하기 쉬운 긴 문장도 사용할 수 있어요.</p>
    <label className="field">새 비밀번호 확인<input ref={repeat} type={visible ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required disabled={busy} maxLength={72} /></label>
    <label className="password-visibility"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />입력한 비밀번호 표시</label>
    {error && <p className="notice err" role="alert">{error}</p>}
    <button className="btn primary" disabled={busy}>{busy ? "저장 중…" : "비밀번호 저장"}</button>
  </form>;
}

export function PasswordSetupPage() {
  const [token, setToken] = useState(passwordResetToken);
  const [account, setAccount] = useState<{ username: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const reopen = () => {
      const next = passwordResetToken();
      if (next !== token) { setAccount(null); setError(null); setToken(next); }
    };
    window.addEventListener("hashchange", reopen);
    return () => window.removeEventListener("hashchange", reopen);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setError(null);
    api<{ username: string }>("/auth/password-reset/check", { method: "POST", body: { token } })
      .then(data => { if (active) setAccount(data); })
      .catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [token, attempt]);
  return <main className="password-setup-page">
    <a href="/" className="password-setup-brand" aria-label="로그인 화면으로"><img src="/branding/space-penguin-company.svg?v=20261018-2" alt="우주펭귄상회" /></a>
    <section className="panel password-setup-panel stack">
      <div><p className="password-eyebrow">ACCOUNT</p><h1>비밀번호 설정</h1><p className="muted">앞으로 로그인할 때 사용할 비밀번호를 직접 정해 주세요.</p></div>
      {!token ? <div className="notice warn"><strong>전용 설정 링크가 필요합니다.</strong><p>발급받은 링크를 다시 열어 주세요. 링크가 만료되었다면 새 링크를 요청해 주세요.</p></div> : error ? <div className="stack"><p className="notice err" role="alert">{error}</p><button className="btn" onClick={() => setAttempt(n => n + 1)}>다시 확인</button></div> : account ? <><PasswordForm username={account.username} resetToken={token} /><p className="password-setup-note">설정이 끝나면 이 링크는 더 이상 사용할 수 없습니다.</p></> : <p role="status">설정 링크를 확인하고 있습니다…</p>}
    </section>
  </main>;
}

export function AccountPage() {
  const me = useMe();
  return <section className="stack account-password-page"><header className="page-head"><div><h1>계정·비밀번호</h1><p className="muted">비밀번호를 변경하면 모든 기기에서 다시 로그인해야 합니다.</p></div></header><div className="panel"><PasswordForm username={me.data?.user || ""} /></div></section>;
}
