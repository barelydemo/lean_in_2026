"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { admin, ApiError, auth, setGuestsAllowed } from "@/lib/api";
import type { Account, Invite, Member } from "@/lib/types";

/** Beta admin: invite testers and watch how far they've got. */
export function AdminPanel() {
  const [me, setMe] = useState<Account | null | undefined>(undefined);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [turnLimit, setTurnLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // "Now" for statuses and "last seen", fixed per page load.
  const [now] = useState(() => Date.now() / 1000);

  const load = useCallback(async () => {
    try {
      const [i, m] = await Promise.all([admin.invites(), admin.members()]);
      setInvites(i.invites);
      setMembers(m.members);
      setTurnLimit(m.turn_limit);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the admin data.");
    }
  }, []);

  useEffect(() => {
    // Never create a guest from here: admins sign in on the game page.
    setGuestsAllowed(false);
    auth.me()
      .then((r) => {
        setMe(r.account);
        if (r.account?.role === "admin") void load();
      })
      .catch(() => setMe(null));
  }, [load]);

  if (me === undefined) return <Shell><p className="text-muted">Loading…</p></Shell>;
  if (!me || me.role !== "admin") {
    return (
      <Shell>
        <h1 className="tight text-3xl font-medium">Admins only</h1>
        <p className="mt-2 text-muted">Sign in with an admin account on the <Link href="/" className="text-shu underline">game page</Link>, then come back.</p>
      </Shell>
    );
  }

  const active = members.filter((m) => now - m.last_seen < 7 * 86_400).length;
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Lexical · closed beta</p>
          <h1 className="tight text-4xl font-medium">Admin</h1>
        </div>
        <p className="text-sm text-muted">Signed in as {me.display_name || me.email} · <Link href="/" className="hover:text-ink">back to the game</Link></p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Testers" value={members.filter((m) => m.account.role !== "admin").length} />
        <Stat label="Active this week" value={active} />
        <Stat label="Open invites" value={invites.filter((i) => status(i, now) === "open").length} />
        <Stat label="Finished the story" value={members.filter((m) => m.progress?.finished).length} />
      </div>

      {error && <p className="mt-4 rounded-xl bg-shu/10 px-4 py-2 text-sm text-shu">{error}</p>}

      <section className="mt-10">
        <h2 className="tight text-2xl font-medium">Invites</h2>
        <InviteForm onCreated={(inv) => { setInvites((v) => [inv, ...v]); void navigator.clipboard?.writeText(inv.link).catch(() => {}); }} onError={setError} />
        <div className="mt-4 overflow-x-auto rounded-2xl bg-white/80">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr>{["Code", "For", "Note", "Access", "Used", "Expires", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {invites.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-muted">No invites yet.</td></tr>}
              {invites.map((i) => {
                const st = status(i, now);
                return (
                  <tr key={i.code} className="border-t border-hairline">
                    <td className="px-4 py-2.5 font-mono tracking-wider">{i.code}</td>
                    <td className="px-4 py-2.5">{i.email ?? <span className="text-muted">anyone</span>}</td>
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-ink/75">{i.note}</td>
                    <td className="px-4 py-2.5">{i.full_access ? <Badge tone="live">full game</Badge> : <span className="text-muted">demo</span>}</td>
                    <td className="px-4 py-2.5 tabular-nums">{i.uses}/{i.max_uses}</td>
                    <td className="px-4 py-2.5 text-ink/75">{date(i.expires_at)}</td>
                    <td className="px-4 py-2.5"><Badge tone={st === "open" ? "live" : "dim"}>{st}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {st === "open" && (
                        <>
                          <CopyButton text={i.link} />
                          <button onClick={async () => {
                            try { await admin.revoke(i.code); setInvites((v) => v.map((x) => (x.code === i.code ? { ...x, revoked: true } : x))); }
                            catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't revoke."); }
                          }} className="ml-1 rounded-full px-3 py-1 text-xs text-muted transition hover:bg-shu/10 hover:text-shu">Revoke</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="tight text-2xl font-medium">Testers</h2>
          <button onClick={() => void load()} className="text-sm text-muted hover:text-ink">Refresh</button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl bg-white/80">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr>{["Tester", "Access", "Last seen", "Turns today", "Lesson", "Where", "Goals", "Words owned", "Scenes"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const p = m.progress;
                return (
                  <tr key={m.account.id} className="border-t border-hairline">
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">{m.account.display_name || "—"} {m.account.role === "admin" && <Badge tone="dim">admin</Badge>}</span>
                      <span className="block text-xs text-muted">{m.account.email} · joined {date(m.joined)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {m.account.role === "admin" ? (
                        <span className="text-muted">full (admin)</span>
                      ) : (
                        <button onClick={async () => {
                          const fullNow = !m.account.full_access;
                          try {
                            await admin.setAccess(m.account.id, fullNow);
                            setMembers((v) => v.map((x) => (x.account.id === m.account.id ? { ...x, account: { ...x.account, full_access: fullNow } } : x)));
                          } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't change access."); }
                        }} className={`rounded-full px-3 py-1 text-xs transition ${m.account.full_access ? "bg-ink text-cream hover:bg-ink/80" : "bg-cream-deep hover:bg-ink hover:text-cream"}`}
                          title={m.account.full_access ? "Click to limit to the demo" : "Click to unlock the full game"}>
                          {m.account.full_access ? "Full game" : "Demo"}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink/75">{ago(m.last_seen, now)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.turns_today}/{turnLimit}</td>
                    <td className="px-4 py-2.5">{p ? <>{p.lesson} <span className="text-muted">· {p.lesson_title}</span></> : <span className="text-muted">not started</span>}</td>
                    <td className="px-4 py-2.5 text-ink/75">{p?.finished ? "Finished" : p?.place ?? ""}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p ? `${p.candos_done}/${p.candos_total}` : ""}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p?.words_owned ?? ""}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p?.scenes_cleared ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

function InviteForm({ onCreated, onError }: { onCreated: (i: Invite) => void; onError: (e: string) => void }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(14);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Invite | null>(null);
  const input = "rounded-full bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20";
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl bg-cream-deep/60 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const inv = await admin.createInvite({ email, note, max_uses: uses, days, full_access: full });
          setMade(inv);
          onCreated(inv);
          setEmail("");
          setNote("");
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Couldn't create the invite.");
        } finally {
          setBusy(false);
        }
      }}>
      <Field label="Email (optional — locks the invite to them)"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anyone with the link" className={`${input} w-64`} /></Field>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="who it's for" maxLength={120} className={`${input} w-48`} /></Field>
      <Field label="Uses"><input type="number" min={1} max={100} value={uses} onChange={(e) => setUses(Number(e.target.value))} className={`${input} w-20`} /></Field>
      <Field label="Valid (days)"><input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${input} w-20`} /></Field>
      <label className="flex items-center gap-2 self-center pb-1 text-sm text-ink/80">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} className="h-4 w-4 accent-ink" />
        Full game (past the demo)
      </label>
      <button disabled={busy} className="rounded-full bg-ink px-5 py-2 text-sm text-cream transition hover:bg-ink/85 disabled:opacity-50">Create invite</button>
      {made && (
        <p className="w-full text-sm text-ink/80">
          Link copied: <span className="font-mono text-ink">{made.link}</span> <CopyButton text={made.link} />
        </p>
      )}
    </form>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {});
    }} className="rounded-full bg-cream-deep px-3 py-1 text-xs transition hover:bg-ink hover:text-cream">
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

function status(i: Invite, now: number): "open" | "used up" | "expired" | "revoked" {
  if (i.revoked) return "revoked";
  if (i.uses >= i.max_uses) return "used up";
  if (i.expires_at < now) return "expired";
  return "open";
}

const date = (ts: number) => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function ago(ts: number, now: number): string {
  if (!ts) return "never";
  const s = now - ts;
  if (s < 120) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-cream px-5 py-10 text-ink sm:px-10"><div className="mx-auto max-w-6xl">{children}</div></main>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/80 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="tight mt-1 text-3xl font-medium tabular-nums">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[11px] text-muted">{label}{children}</label>;
}

function Badge({ tone, children }: { tone: "live" | "dim"; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone === "live" ? "bg-ink text-cream" : "bg-cream-deep text-ink/60"}`}>{children}</span>;
}
