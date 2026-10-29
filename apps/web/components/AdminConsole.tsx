"use client";

import { useCallback, useEffect, useState } from "react";
import { admin, type Account, type AuditEntry, type RegistryEntry, type Role, type SessionUser } from "@/lib/api";
import { fmtNum } from "@/lib/format";

const ROLES: Role[] = ["CITIZEN", "RANGER", "RESEARCHER", "ADMIN"];
type Tab = "accounts" | "species" | "audit";

export function AdminConsole({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1>BioSphere admin</h1>
          <p className="muted">Signed in as {user.name}</p>
        </div>
        <nav className="link-row">
          <a className="link" href="/">Map</a>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </nav>
      </header>
      <div className="segmented admin-tabs" role="tablist">
        {(["accounts", "species", "audit"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "accounts" ? "Accounts" : t === "species" ? "Species registry" : "Audit log"}
          </button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {tab === "accounts" && <Accounts me={user} run={run} />}
      {tab === "species" && <Registry run={run} />}
      {tab === "audit" && <Audit run={run} />}
    </div>
  );
}

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

function Accounts({ me, run }: { me: SessionUser; run: Run }) {
  const [users, setUsers] = useState<Account[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "RANGER" as Role });
  const load = useCallback(() => run(admin.users).then((u) => u && setUsers(u)), [run]);
  useEffect(() => void load(), [load]);

  const update = async (u: Account, patch: { role?: Role; disabled?: boolean }) => {
    if (patch.disabled && !confirm(`Disable ${u.email}? They will be signed out on every device.`)) return;
    if (patch.role && !confirm(`Change ${u.email} to ${patch.role}? Their sessions will be signed out.`)) return;
    const updated = await run(() => admin.updateUser(u.id, patch));
    if (updated) setUsers((list) => list?.map((x) => (x.id === u.id ? updated : x)) ?? null);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await run(() => admin.createUser(form));
    if (created) {
      setUsers((list) => [...(list ?? []), created]);
      setForm({ name: "", email: "", password: "", role: "RANGER" });
    }
  };

  return (
    <section className="admin-section">
      <form className="admin-form" onSubmit={create}>
        <h2>New staff account</h2>
        <input placeholder="Name" aria-label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder="Email" aria-label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Temporary password (10+ chars)" aria-label="Temporary password" type="password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <select aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button className="primary">Create</button>
      </form>

      <table className="data-table admin-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th /></tr>
        </thead>
        <tbody>
          {users?.map((u) => {
            const self = u.id === me.id;
            return (
              <tr key={u.id} className={u.disabled_at ? "disabled" : ""}>
                <td>{u.name}{self && <span className="muted"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select aria-label={`Role for ${u.email}`} value={u.role} disabled={self} onChange={(e) => update(u, { role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>{u.disabled_at ? "Disabled" : "Active"}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="num">
                  {!self && (
                    <button className="link" onClick={() => update(u, { disabled: !u.disabled_at })}>
                      {u.disabled_at ? "Enable" : "Disable"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!users && <p className="muted">Loading accounts…</p>}
    </section>
  );
}

function Registry({ run }: { run: Run }) {
  const [rows, setRows] = useState<RegistryEntry[] | null>(null);
  const [newName, setNewName] = useState("");
  const load = useCallback(() => run(admin.species).then((r) => r && setRows(r)), [run]);
  useEffect(() => void load(), [load]);

  const set = async (name: string, patch: { is_invasive?: boolean; is_sensitive?: boolean }) => {
    if (patch.is_sensitive === false && !confirm(`Make exact ${name} locations visible to citizen accounts? This takes effect immediately.`)) return;
    // Optimistic: flip the switch now, then re-sync with the server (which also reverts on failure).
    setRows((list) => list?.map((r) => (r.species_name === name ? { ...r, ...patch } : r)) ?? null);
    await run(() => admin.updateSpecies(name, patch));
    load();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => admin.updateSpecies(newName.trim(), { is_sensitive: true }))) {
      setNewName("");
      load();
    }
  };

  return (
    <section className="admin-section">
      <form className="admin-form" onSubmit={add}>
        <h2>Protect a species before it is first recorded</h2>
        <input placeholder="Scientific name, e.g. Manis temminckii" aria-label="Scientific name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <button className="primary">Add as sensitive</button>
      </form>
      <p className="notice">
        Sensitive species are shown to citizens at ~11 km resolution, excluded from their analyses, and their photos are hidden.
        Invasive species appear in the frontier layer.
      </p>
      <table className="data-table admin-table">
        <thead>
          <tr><th>Species</th><th className="num">Sightings</th><th>Last seen</th><th>Invasive</th><th>Sensitive</th></tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.species_name}>
              <td><i>{r.species_name}</i></td>
              <td className="num">{fmtNum(r.sightings)}</td>
              <td>{r.last_seen ? new Date(r.last_seen).toLocaleDateString() : "–"}</td>
              <td><input type="checkbox" role="switch" aria-label={`${r.species_name} invasive`} checked={r.is_invasive} onChange={() => set(r.species_name, { is_invasive: !r.is_invasive })} /></td>
              <td><input type="checkbox" role="switch" aria-label={`${r.species_name} sensitive`} checked={r.is_sensitive} onChange={() => set(r.species_name, { is_sensitive: !r.is_sensitive })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows && <p className="muted">Loading registry…</p>}
    </section>
  );
}

function describe(e: AuditEntry) {
  const d = e.details as { before?: Record<string, boolean> | null; after?: Record<string, boolean>; role?: string; disabled?: boolean };
  if (e.action.startsWith("species.") && d.after) {
    return Object.entries(d.after)
      .filter(([k, v]) => d.before?.[k] !== v)
      .map(([k, v]) => `${k.replace("is_", "")} ${v ? "on" : "off"}`)
      .join(", ") || "no change";
  }
  return [d.role && `role ${d.role}`, d.disabled !== undefined && (d.disabled ? "disabled" : "enabled")].filter(Boolean).join(", ");
}

function Audit({ run }: { run: Run }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => void run(admin.audit).then((r) => r && setRows(r)), [run]);
  return (
    <section className="admin-section">
      <table className="data-table admin-table">
        <thead>
          <tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Change</th></tr>
        </thead>
        <tbody>
          {rows?.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.actor_email ?? "(deleted user)"}</td>
              <td><code>{e.action}</code></td>
              <td>{e.action.startsWith("species.") ? <i>{e.target}</i> : e.target}</td>
              <td>{describe(e)}</td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={5} className="muted">No admin actions recorded yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
