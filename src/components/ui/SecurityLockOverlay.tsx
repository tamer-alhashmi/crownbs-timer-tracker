"use client";

import { ShieldAlert } from "lucide-react";

export function SecurityLockOverlay({ reason, countdown }: {
  reason: "role-changed" | "account-suspended";
  countdown: number;
}) {
  const suspended = reason === "account-suspended";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="security-lock-title" aria-describedby="security-lock-description">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center text-ink shadow-2xl">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-700">
          <ShieldAlert className="h-9 w-9 animate-pulse" aria-hidden="true" />
        </div>
        <h1 id="security-lock-title" className="text-2xl font-bold tracking-tight text-slate-950">
          {suspended ? "Account Suspended" : "Permissions Updated"}
        </h1>
        <p id="security-lock-description" className="mt-3 text-sm leading-6 text-slate-600">
          {suspended
            ? "Your account has been deactivated. Contact management if you believe this is a mistake."
            : "Your role or permissions have changed. Sign in again to continue with updated access."}
        </p>
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700" aria-live="assertive">
          Signing you out in <span className="font-bold tabular-nums text-slate-950">{countdown}</span> seconds…
        </p>
      </section>
    </div>
  );
}
