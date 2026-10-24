"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, LoaderCircle, Mail, ShieldCheck, X } from "lucide-react";
import { showActionToast } from "@/components/ui/ActionToast";
import {
  requestEmailVerification,
  saveDigestPreferences,
  verifyEmailAddress,
} from "./profileActions";
import { PushNotificationSettings } from "./PushNotificationSettings";

type Props = {
  email: string;
  emailVerified: boolean;
  weeklyDigestEnabled: boolean;
  monthlyDigestEnabled: boolean;
  pushPublicKey: string | null;
};

export function EmailVerificationSettings({
  email,
  emailVerified,
  weeklyDigestEnabled,
  monthlyDigestEnabled,
  pushPublicKey,
}: Props) {
  const [requestedEmail, setRequestedEmail] = useState(email);
  const [weekly, setWeekly] = useState(weeklyDigestEnabled);
  const [monthly, setMonthly] = useState(monthlyDigestEnabled);
  const [code, setCode] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();

  const requestCode = () => startTransition(async () => {
    setNotice("");
    try {
      await requestEmailVerification(requestedEmail);
      setModalOpen(true);
      showActionToast("success", "Verification code sent.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send a verification code.";
      setNotice(message);
      showActionToast("error", message);
    }
  });

  const verifyCode = () => startTransition(async () => {
    setNotice("");
    try {
      await verifyEmailAddress(requestedEmail, code);
      setModalOpen(false);
      setCode("");
      setNotice("Your email address has been verified.");
      showActionToast("success", "Your email address has been verified.");
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify this email address.";
      setNotice(message);
      showActionToast("error", message);
    }
  });

  const toggleDigest = (cadence: "weekly" | "monthly") => {
    const nextWeekly = cadence === "weekly" ? !weekly : weekly;
    const nextMonthly = cadence === "monthly" ? !monthly : monthly;
    startTransition(async () => {
      setNotice("");
      try {
        await saveDigestPreferences({ weekly: nextWeekly, monthly: nextMonthly });
        setWeekly(nextWeekly);
        setMonthly(nextMonthly);
        showActionToast("success", "Email digest preferences saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to save digest preferences.";
        setNotice(message);
        showActionToast("error", message);
      }
    });
  };

  return (
    <>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 rounded-xl p-2 ${emailVerified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
            {emailVerified ? <ShieldCheck className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            {emailVerified ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-950">Verified email</h3>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Verified</span>
                </div>
                <p className="mt-1 break-all text-sm text-slate-600">{email}</p>
              </>
            ) : (
              <>
                <h3 className="font-bold text-amber-950">⚠️ Email Not Verified</h3>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  Link your verified email to enable Weekly &amp; Monthly executive summaries.
                </p>
                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  Personal Email Address
                  <input
                    type="email"
                    autoComplete="email"
                    value={requestedEmail}
                    onChange={(event) => setRequestedEmail(event.target.value)}
                    maxLength={254}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 sm:max-w-md"
                  />
                </label>
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={isPending}
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Send Verification Code
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <DigestSwitch
            label="Weekly Executive Summary"
            checked={weekly}
            disabled={!emailVerified || isPending}
            onClick={() => toggleDigest("weekly")}
          />
          <DigestSwitch
            label="Monthly Operations Closure"
            checked={monthly}
            disabled={!emailVerified || isPending}
            onClick={() => toggleDigest("monthly")}
          />
        </div>
        {!emailVerified && (
          <p className="mt-2 text-xs text-slate-500" title="Verify your email to manage executive summaries.">
            Verify your email to enable these options.
          </p>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}
      </section>

      <PushNotificationSettings publicKey={pushPublicKey} />

      {modalOpen && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPending) setModalOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="email-code-title" className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <header className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Email security</p>
                <h3 id="email-code-title" className="mt-1 text-xl font-bold text-slate-950">Enter verification code</h3>
                <p className="mt-1 break-all text-sm text-slate-600">Sent to {requestedEmail}</p>
              </div>
              <button type="button" aria-label="Close verification dialog" onClick={() => setModalOpen(false)} disabled={isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </header>
            <label className="mt-5 block text-sm font-semibold text-slate-700">
              Six-digit code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center font-mono text-2xl tracking-[0.55em] text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">The code expires in 10 minutes.</p>
            {notice && <p role="alert" className="mt-3 text-sm text-rose-700">{notice}</p>}
            <button
              type="button"
              onClick={verifyCode}
              disabled={isPending || code.length !== 6}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verify email
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function DigestSwitch({
  label,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={disabled ? "Verify your email to manage this preference." : undefined}
        disabled={disabled}
        onClick={onClick}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${checked ? "bg-sky-700" : "bg-slate-300"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}
