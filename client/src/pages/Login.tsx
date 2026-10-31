import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrf } from "../api";
import type { Me } from "../state";

export function LoginPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ csrf: string }>("/auth/login", { method: "POST", body: { username, password } });
      setCsrf(r.csrf);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "로그인 실패");
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    const r = await api<{ csrf: string }>("/auth/demo", { method: "POST" });
    setCsrf(r.csrf);
    await qc.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <main className="login-page" data-design="studio-20261101">
      <div className="login-intro">
        <img className="login-brand-logo" src="/branding/space-penguin-company.svg?v=20261018-2" alt="우주펭귄상회 · space penguin company" />
        <h1>콘텐츠 스튜디오</h1>
        <p>자료 수집부터 카드뉴스·웹툰 제작까지.</p>
        <div className="login-workflow"><span>자료 수집</span><span>콘텐츠 제작</span><span>발행 관리</span></div>
      </div>
      <div className="panel stack login-panel">
        <div>
          <h2 className="login-brand-title">로그인</h2>
        </div>
        {!me.authConfigured && (
          <div className="notice warn">
            운영자 인증이 아직 설정되지 않았습니다. 서버 환경변수 <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD_HASH</code>, <code>APP_SESSION_SECRET</code>을 설정하세요. (README 3단계)
          </div>
        )}
        <form className="stack" onSubmit={submit}>
          <label className="field">
            아이디
            <input autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} required />
          </label>
          <label className="field">
            비밀번호
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />
          </label>
          {err && (
            <div className="notice err" role="alert">
              {err}
            </div>
          )}
          <button className="btn primary" disabled={busy || !me.authConfigured}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
        {me.demoAllowed && (
          <button className="btn" onClick={demo}>
            샘플 모드로 둘러보기 (개발 환경 전용 · 실제 정보 아님)
          </button>
        )}
      </div>
    </main>
  );
}


