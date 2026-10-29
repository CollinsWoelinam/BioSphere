"use client";

import dynamic from "next/dynamic";
import { AdminConsole } from "@/components/AdminConsole";
import { LoginScreen } from "@/components/LoginScreen";
import { useSession } from "@/lib/session";

function AdminPage() {
  const { session, signIn, signOut } = useSession();
  if (!session) return <LoginScreen onSignedIn={signIn} />;
  if (session.user.role !== "ADMIN") {
    return (
      <main className="login">
        <div className="login-card">
          <h1>Admin only</h1>
          <p className="muted">This area is for BioSphere administrators.</p>
          <a className="primary button-link" href="/">Back to the map</a>
        </div>
      </main>
    );
  }
  return <AdminConsole user={session.user} onSignOut={signOut} />;
}

export default dynamic(() => Promise.resolve(AdminPage), { ssr: false });
