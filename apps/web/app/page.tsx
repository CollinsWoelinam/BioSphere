"use client";

import dynamic from "next/dynamic";
import { LoginScreen } from "@/components/LoginScreen";
import { useSession } from "@/lib/session";

// MapLibre and deck.gl need WebGL and `window`, so the workspace renders client-side only.
const Workspace = dynamic(() => import("@/components/Workspace").then((m) => m.Workspace), {
  ssr: false,
  loading: () => <div className="boot muted">Loading BioSphere…</div>,
});

function Home() {
  const { session, signIn, signOut } = useSession();
  if (!session) return <LoginScreen onSignedIn={signIn} />;
  return <Workspace key={session.user.id} user={session.user} onSignOut={signOut} />;
}

// localStorage is only available in the browser, so render the session gate client-side.
export default dynamic(() => Promise.resolve(Home), { ssr: false });
