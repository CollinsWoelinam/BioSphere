"use client";

import { useState } from "react";
import { auth, type Session } from "@/lib/api";

const DEV = process.env.NODE_ENV !== "production";

export function LoginScreen({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(mode === "login" ? await auth.login(email, password) : await auth.register(name, email, password));
    } catch (err) {
      setError((err as Error).message === "Failed to fetch" ? "Cannot reach the BioSphere API." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>BioSphere</h1>
        <p className="muted">Research &amp; Analytics Portal</p>

        {mode === "register" && (
          <label className="field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="field">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 10 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create citizen account"}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New citizen scientist? Create an account" : "Already have an account? Sign in"}
        </button>
        {mode === "register" && (
          <p className="muted small">Ranger and researcher accounts are issued by an administrator.</p>
        )}
        {DEV && mode === "login" && (
          <p className="muted small dev-hint">
            Dev accounts (from <code>pnpm db:seed</code>): <code>ranger@biosphere.local</code> or{" "}
            <code>citizen@biosphere.local</code>, password <code>biosphere-dev</code>
          </p>
        )}
      </form>
    </main>
  );
}
