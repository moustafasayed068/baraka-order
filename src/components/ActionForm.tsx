"use client";
import { useActionState } from "react";

export type ActionResult = { ok?: boolean; error?: string } | null;

// <form> bound to a server action, with "saved" / error feedback and a disabled submit while pending.
export function ActionForm({ action, children, submit, saved, failed, errors, className = "grid-form" }: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode; submit: string; saved: string; failed: string; errors?: Record<string, string>; className?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn w-auto! px-6!" disabled={pending}>{submit}</button>
        {state?.ok && !pending && <span className="ok-note" role="status">✓ {saved}</span>}
        {state?.error && !pending && <span className="err" role="alert">{errors?.[state.error] ?? failed}</span>}
      </div>
    </form>
  );
}
