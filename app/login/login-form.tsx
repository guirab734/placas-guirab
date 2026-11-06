"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { ThemeToggle } from "../components/theme-toggle";
import "./login.css";

function returnPath() {
  const path = new URLSearchParams(window.location.search).get("return_to");
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  try {
    const url = new URL(path, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!password) { setError("Digite sua senha para entrar."); passwordRef.current?.focus(); return; }
    submittingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), credentials: "same-origin" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.error || (response.status === 429 ? "Muitas tentativas. Aguarde um pouco e tente novamente." : response.status === 401 ? "Senha incorreta. Tente novamente." : "Não foi possível entrar agora. Tente novamente."));
      }
      setPassword("");
      window.location.href = returnPath();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível conectar. Tente novamente.");
      setLoading(false);
      submittingRef.current = false;
      window.setTimeout(() => passwordRef.current?.focus(), 0);
    }
  }

  return <div className="entry-page">
    <header className="entry-topbar">
      <a className="entry-brand" href="/" aria-label="Guirab Placas"><span className="entry-brand-sign" aria-hidden="true"><svg viewBox="0 0 38 38" fill="none" width="30" height="30"><path d="M10 28a13 13 0 0 1 0-18m8 18a13 13 0 0 0 0-18M26 10a13 13 0 0 1 0 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><circle cx="14" cy="19" r="3" fill="currentColor"/></svg></span><span>guirab<span className="entry-brand-divider" aria-hidden="true">/</span><span className="entry-brand-product">placas</span></span></a>
      <ThemeToggle />
    </header>
    <main className="entry-main" aria-labelledby="entry-heading">
      <section className="entry-pass">
        <div className="entry-pass-cover">
          <div className="entry-cover-meta"><span className="entry-kicker">Seu espaço de gestão</span><LockKeyhole size={16} aria-hidden="true" /></div>
          <div className="entry-signal" aria-hidden="true"><svg viewBox="0 0 112 76" fill="none"><rect x="68" y="7" width="34" height="62" rx="9" stroke="currentColor" strokeWidth="3" /><path d="M78 15h14M83 61h4M47 8c17 17 17 43 0 60M33 19c11 11 11 27 0 38M19 29c5 5 5 11 0 17" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /><circle cx="7" cy="38" r="3.5" fill="currentColor" /></svg></div>
          <h1 id="entry-heading">Tudo começa<br />com uma conexão.</h1>
          <p>Suas placas, suas lojas.<br />E o próximo lugar a descobrir.</p>
        </div>
        <div className="entry-pass-seam" aria-hidden="true"><span /></div>
        <div className="entry-pass-access">
          <div className="entry-form-heading"><h2>Acesse o painel</h2><span>Guirab Placas</span></div>
          <form onSubmit={submit} aria-busy={loading}>
            <label htmlFor="login-password">Senha de acesso</label>
            <div className={`entry-password${error ? " is-invalid" : ""}`}>
              <input id="login-password" ref={passwordRef} type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }} placeholder="Digite sua senha" autoComplete="current-password" required disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : "login-password-hint"} />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} disabled={loading}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
            </div>
            <p className="entry-hint" id="login-password-hint">Use a senha definida para este painel.</p>
            {error && <p className="entry-error" id="login-error" role="alert">{error}</p>}
            <button className="entry-submit" type="submit" disabled={loading}>{loading ? <>Entrando<LoaderCircle className="entry-spinner" size={19} aria-hidden="true" /></> : <>Entrar no painel<ArrowRight size={19} aria-hidden="true" /></>}</button>
          </form>
          <div className="entry-pass-foot"><span className="entry-status-dot" aria-hidden="true" /><span>Acesso do administrador</span></div>
        </div>
      </section>
      <p className="entry-domain">placas.guirab.com.br</p>
    </main>
    <footer className="entry-footer"><span>Uma placa. Muitas conexões.</span><span>Do balcão ao digital <ArrowRight size={13} aria-hidden="true" /></span></footer>
  </div>;
}
