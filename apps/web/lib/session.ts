"use client";

import { useCallback, useState } from "react";
import { configureAuth, type Session } from "./api";

const KEY = "biosphere.session";

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // Drop tokens that have already expired rather than waiting for a 401.
    const { exp } = JSON.parse(atob(s.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof exp === "number" && exp * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(() => {
    const s = typeof window === "undefined" ? null : read();
    configureAuth(s?.token ?? null, () => {});
    return s;
  });

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    configureAuth(null, () => {});
    setSession(null);
  }, []);

  const signIn = useCallback(
    (s: Session) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
      configureAuth(s.token, signOut);
      setSession(s);
    },
    [signOut],
  );

  // Re-arm the 401 handler now that signOut exists.
  if (session) configureAuth(session.token, signOut);

  return { session, signIn, signOut };
}
