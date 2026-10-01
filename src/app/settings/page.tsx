import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Clock3, Mail, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { PayrollSummary } from "@/components/dashboard/PayrollSummary";
import { getSettingsData } from "./actions";
import UserSettingsClient from "./UserSettingsClient";
import SystemAccessPanel from "./SystemAccessPanel";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "cleaner") {
    const supabase = createPrivilegedServerSupabaseClient();
    const [{ data: profile }, { data: hotel }, { data: payroll }] = await Promise.all([
      supabase.from("users").select("full_name, email").eq("id", user.userId).maybeSingle(),
      user.hotelId ? supabase.from("hotels").select("name, location").eq("id", user.hotelId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("work_logs").select("id, start_time, end_time, task_date, rooms_completed, is_locked, cost_override, deleted_at, cancelled_at, services_config(name, default_rate, unit)").eq("user_id", user.userId).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null).order("start_time", { ascending: false }),
    ]);
    const name = profile?.full_name ?? user.email;
    return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 sm:py-10"><div className="mx-auto max-w-5xl">
      <nav className="mb-5 flex items-center justify-between gap-4"><Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Shift overview</Link><UserProfileMenu name={name} email={profile?.email ?? user.email} role="cleaner" settingsHref="/settings" /></nav>
      <header className="mb-6 flex flex-col gap-5 rounded-2xl bg-slate-900 p-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-7"><div className="flex items-center gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-sky-400/15 text-sky-200"><UserRound className="h-7 w-7" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Cleaner account</p><h1 className="mt-1 text-2xl font-bold">Settings & preferences</h1><p className="mt-1 text-sm text-slate-300">Your profile and workday defaults</p></div></div><span className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200"><ShieldCheck className="h-4 w-4" /> Cleaner access</span></header>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"><section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Profile</p><h2 className="mt-1 text-lg font-bold">Personal information</h2></div><UserRound className="h-5 w-5 text-slate-400" /></div><dl className="mt-5 divide-y divide-slate-100"><ProfileField icon={UserRound} label="Full name" value={name} /><ProfileField icon={Mail} label="Email address" value={profile?.email ?? user.email} /><ProfileField icon={ShieldCheck} label="Account role" value="Cleaner" /></dl><p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-600">Profile details are managed by your operations administrator. Contact them if your name or email needs to change.</p></section>
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Work profile</p><h2 className="mt-1 text-lg font-bold">Your operating defaults</h2></div><Building2 className="h-5 w-5 text-slate-400" /></div><dl className="mt-5 divide-y divide-slate-100"><ProfileField icon={MapPin} label="Active hotel" value={hotel?.name ?? "No hotel assigned"} /><ProfileField icon={Clock3} label="Work time zone" value="Europe/London" /><ProfileField icon={Clock3} label="Time display" value="24-hour clock" /></dl><p className="mt-4 text-sm leading-5 text-slate-500">Your active hotel can be changed from the shift overview when you are not running a task.</p></section></div>
      <div className="mt-5"><PayrollSummary logs={payroll ?? []} /></div>
      <section className="mt-5 flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Account session</p><h2 className="mt-1 font-bold">Sign out of this device</h2><p className="mt-1 text-sm text-slate-500">Your shift and submitted work logs remain saved.</p></div><SignOutButton /></section>
    </div></main>;
  }
  const data = await getSettingsData();
  return <><UserSettingsClient actorRole={data.actorRole} actorName={data.actorName} actorEmail={data.actorEmail} hotels={data.hotels} users={data.users} /><SystemAccessPanel users={data.users} permissions={data.permissions} /></>;
}

function ProfileField({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="grid grid-cols-[1.25rem_7rem_1fr] items-center gap-3 py-3 text-sm"><Icon className="h-4 w-4 text-slate-400" /><dt className="text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value}</dd></div>;
}
