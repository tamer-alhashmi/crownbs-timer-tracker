"use client";

import { useState } from "react";
import { Clock3, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { login } from "./actions";

export default function LoginPage() {
  const [method, setMethod] = useState<"email" | "pin">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (formData: FormData) => {
    formData.set("method", method);
    try {
      setError("");
      const result = await login(formData);
      setError(result.error);
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
      setError("Unable to sign in right now. Please try again.");
    }
  };

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

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMethod("email")}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              method === "email" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Mail className="h-4 w-4" /> Email
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMethod("pin")}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              method === "pin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> PIN
            </span>
          </button>
        </div>

        <form action={handleSubmit} className="space-y-4">
          {method === "email" ? (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email address
                </label>
                <input
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="name@hotel.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <input
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email / Username
                </label>
                <input
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
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  4-digit PIN code
                </label>
                <input
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
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Sign in
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Secure access for cleaners and admin team
        </div>
      </div>
    </main>
  );
}
