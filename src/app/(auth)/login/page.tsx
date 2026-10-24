"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock3, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-100" />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [method, setMethod] = useState<"email" | "pin">("email");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (formData: FormData) => {
    formData.set("method", method);
    if (rememberMe && method === "email") formData.set("rememberMe", "on");
    try {
      setIsBusy(true);
      setError("");
      setNotice("");
      const result = await login(formData);
      if (result.redirectTo) {
        router.replace(result.redirectTo);
        return;
      }
      setError(result.error ?? "");
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "digest" in err &&
        typeof err.digest === "string" &&
        err.digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      console.error("[Auth Exception]:", err);
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    if (!resetEmail.trim()) {
      setError("Enter your email address to receive a password reset link.");
      return;
    }
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        console.error("[Auth Exception]:", resetError);
        setError("Unable to send a password reset link. Please check your connection and try again.");
        return;
      }
      setNotice("A password reset link has been sent to your email. Please check your inbox.");
    } catch (err) {
      console.error("[Auth Exception]:", err);
      setError("Unable to send a password reset link. Please check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) {
        console.error("[Auth Exception]:", oauthError);
        setError("Unable to continue with Google. Please try again.");
        setIsBusy(false);
      }
    } catch (err) {
      console.error("[Auth Exception]:", err);
      setError("Unable to continue with Google. Please try again.");
      setIsBusy(false);
    }
  };

  const callbackError = searchParams.get("authError");
  const displayedError = error || (callbackError === "profile"
    ? "This account is not set up for app access. Please contact your administrator."
    : callbackError === "callback"
      ? "Unable to complete sign in. Please try again."
      : "");
  const displayedNotice = notice || (searchParams.get("passwordUpdated") === "1"
    ? "Your password has been updated successfully. Please sign in."
    : "");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
            <Clock3 className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Hotel Ops
            </p>
            <h1 className="text-2xl font-bold text-slate-900">Time Tracker</h1>
          </div>
        </div>

        {!forgotPassword && <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => { setMethod("email"); setError(""); setNotice(""); }}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              method === "email" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Mail className="h-4 w-4" /> Email &amp; Password
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMethod("pin"); setError(""); setNotice(""); }}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              method === "pin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> PIN Code
            </span>
          </button>
        </div>}

        {forgotPassword ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Reset your password</h2>
              <p className="mt-1 text-sm text-slate-500">Enter your registered email address and we’ll send you a reset link.</p>
            </div>
            <div>
              <label htmlFor="reset-email" className="mb-2 block text-sm font-medium text-slate-700">Email address</label>
              <input
                id="reset-email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="name@hotel.com"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                required
              />
            </div>
            <button
              type="button"
              onClick={requestPasswordReset}
              disabled={isBusy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Send reset link
            </button>
            <button type="button" onClick={() => { setForgotPassword(false); setError(""); setNotice(""); }} className="w-full text-sm font-medium text-emerald-700 hover:text-emerald-800">
              Back to sign in
            </button>
          </div>
        ) : <form action={handleSubmit} className="space-y-4">
          {method === "email" ? (
            <>
              <div>
                <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-slate-700">
                  Email address
                </label>
                <input
                  id="login-email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                  placeholder="name@hotel.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                  required
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={passwordVisible ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                    required
                  />
                  <button
                    type="button"
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 hover:text-slate-700"
                  >
                    {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      name="rememberMe"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Remember me
                  </label>
                  <button type="button" onClick={() => { setResetEmail(email); setForgotPassword(true); setError(""); setNotice(""); }} className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
                    Forgot Password?
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="pin-email" className="mb-2 block text-sm font-medium text-slate-700">
                  Email / Username
                </label>
                <input
                  id="pin-email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="text"
                  autoComplete="username"
                  placeholder="name@hotel.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                  required
                />
              </div>
              <div>
                <label htmlFor="pin-code" className="mb-2 block text-sm font-medium text-slate-700">
                  4-digit PIN code
                </label>
                <input
                  id="pin-code"
                  name="pinCode"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.slice(0, 4))}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                  required
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>}

        {displayedError ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {displayedError}
          </div>
        ) : null}
        {displayedNotice ? <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{displayedNotice}</div> : null}

        {!forgotPassword && <>
        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          OR CONTINUE WITH
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.65 5.94c4.47-4.13 7.12-10.2 7.12-17.59Z" />
            <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 4)" />
            <path fill="#34A853" d="M24 48c6.47 0 11.9-2.13 15.86-5.86l-7.65-5.94c-2.13 1.43-4.86 2.28-8.21 2.28-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)" />
          </svg>
          Continue with Google
        </button>
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Secure access for cleaners and admin team
        </div>
        </>}
      </div>
    </main>
  );
}
