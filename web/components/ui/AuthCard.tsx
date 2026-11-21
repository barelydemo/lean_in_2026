"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ApiError, auth } from "@/lib/api";
import { audio } from "@/lib/audio/engine";
import { useI18n } from "@/lib/i18n";
import type { Account } from "@/lib/types";
import { PillButton } from "./Frame";

/**
 * Sign in, or join the beta with an invite. An invite link (?invite=CODE)
 * opens straight onto joining with the code filled in.
 */
export function AuthCard({ invite, inviteOnly = true, onAuthed, onBack }: {
  invite: string | null;
  /** Closed beta: joining needs a code. Otherwise the code is optional. */
  inviteOnly?: boolean;
  onAuthed: (a: Account) => void;
  /** Guests can play: offer a way back to the title. */
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "join">(invite ? "join" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(invite ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = mode === "login"
        ? await auth.login(email, password)
        : await auth.signup({ email, password, name, invite: code });
      audio.ui("choice");
      onAuthed(account);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.auth.failed);
    } finally {
      setBusy(false);
    }
  };

  const field = "tight w-full rounded-full bg-white/90 px-4 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-ink/20";

  return (
    <motion.form onSubmit={submit} className="frost w-full max-w-sm rounded-[22px] p-4 text-ink"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-3 flex gap-1 rounded-full bg-ink/5 p-1 text-sm">
        {(["login", "join"] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setError(null); }}
            className={`relative flex-1 rounded-full py-1.5 transition ${mode === m ? "text-cream" : "text-ink/65 hover:text-ink"}`}>
            {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-ink" />}
            <span className="relative">{m === "login" ? t.auth.signIn : t.auth.join}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {mode === "join" && (
            <motion.div key="join" className="space-y-2 overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={inviteOnly ? t.auth.invite : t.auth.inviteOptional}
                autoComplete="off" spellCheck={false} maxLength={20} className={`${field} font-mono tracking-widest`} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.auth.name} maxLength={32} autoComplete="nickname" className={field} />
            </motion.div>
          )}
        </AnimatePresence>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.auth.email} autoComplete="email" className={field} />
        <input type="password" required minLength={mode === "join" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "join" ? t.auth.newPassword : t.auth.password} autoComplete={mode === "join" ? "new-password" : "current-password"} className={field} />
      </div>
      {error && <p className="tight mt-2 text-[13px] text-shu">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="tight text-[12px] leading-snug text-muted">
          {onBack ? (
            <button type="button" onClick={onBack} className="underline decoration-dotted underline-offset-2 hover:text-ink">← {t.back}</button>
          ) : mode === "join" ? (inviteOnly ? t.auth.betaNote : t.auth.joinNote) : inviteOnly ? t.auth.noAccount : t.auth.noAccountOpen}
        </p>
        <PillButton type="submit" disabled={busy} tone="dark">{busy ? "…" : mode === "login" ? t.auth.signIn : t.auth.joinShort}</PillButton>
      </div>
    </motion.form>
  );
}
