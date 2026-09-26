import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
      <div className="w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-emerald-400">
              Hotel Operations Suite
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
              Hotel Time Tracker
            </h1>
          </div>

          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Open portal
          </Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            "Cleaner mobile attendance and tasks",
            "Multi-hotel assignments with travel tracking",
            "Admin and owner operational dashboards",
          ].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-slate-200"
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
