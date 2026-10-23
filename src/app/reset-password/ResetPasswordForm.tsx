"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match. Please check and try again.");
      return;
    }

    setIsBusy(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        console.error("[Auth Exception]:", updateError);
        setError("Unable to update your password. Please reopen the reset link and try again.");
        return;
      }
      setSuccess(true);
      window.setTimeout(() => router.replace("/login?passwordUpdated=1"), 1800);
    } catch (err) {
      console.error("[Auth Exception]:", err);
      setError("Unable to update your password. Please check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  if (success) {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Your password has been updated successfully. Redirecting you to sign in.
      </div>
    );
  }

  return (
    <form onSubmit={updatePassword} className="space-y-4">
      <div>
        <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-700">New password</label>
        <div className="relative">
          <input
            id="new-password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
            required
            minLength={8}
          />
          <button type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible((visible) => !visible)} className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
            {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Use at least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</label>
        <div className="relative">
          <input
            id="confirm-password"
            type={confirmVisible ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
            required
            minLength={8}
          />
          <button type="button" aria-label={confirmVisible ? "Hide password" : "Show password"} onClick={() => setConfirmVisible((visible) => !visible)} className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
            {confirmVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={isBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
        {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
        Update password
      </button>
    </form>
  );
}
