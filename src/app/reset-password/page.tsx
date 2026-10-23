import { Clock3 } from "lucide-react";
import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><Clock3 className="h-7 w-7" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hotel Ops</p>
            <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
          </div>
        </div>
        <p className="mb-5 text-sm text-slate-600">Choose a new password for your account.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
