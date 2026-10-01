import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Clock3, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { PayrollSummary } from "@/components/dashboard/PayrollSummary";
import { SystemManual } from "@/components/dashboard/SystemManual";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { getSettingsData } from "./actions";
import UserSettingsClient from "./UserSettingsClient";
import SystemAccessPanel from "./SystemAccessPanel";
import PersonalProfileSettings from "./PersonalProfileSettings";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("full_name, email, phone_number, avatar_url")
    .eq("id", user.userId)
    .maybeSingle();
  if (profileError) throw new Error(`Unable to load profile settings: ${profileError.message}`);

  if (user.role === "cleaner") {
    const [{ data: hotel }, { data: payroll }] = await Promise.all([
      user.hotelId ? supabase.from("hotels").select("name, location").eq("id", user.hotelId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("work_logs").select("id, start_time, end_time, task_date, rooms_completed, is_locked, cost_override, deleted_at, cancelled_at, services_config(name, default_rate, unit)").eq("user_id", user.userId).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null).order("start_time", { ascending: false }),
    ]);
    const name = profile?.full_name ?? user.email;

    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <nav className="mb-5 flex items-center justify-between gap-4">
            <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Shift overview</Link>
            <UserProfileMenu name={name} email={profile?.email ?? user.email} avatarUrl={profile?.avatar_url} role="cleaner" settingsHref="/settings" />
          </nav>
          <header className="mb-6 flex flex-col gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex items-center gap-4">
              <UserAvatar name={name} avatarUrl={profile?.avatar_url} className="h-14 w-14 bg-sky-100 text-xl font-semibold text-sky-800" />
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Cleaner account</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Settings & preferences</h1><p className="mt-1 text-sm text-slate-600">Update your profile and review quick shift and task guidance.</p></div>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><ShieldCheck className="h-4 w-4" /> Cleaner access</span>
          </header>
          <PersonalProfileSettings fullName={name} email={profile?.email ?? user.email} phoneNumber={profile?.phone_number ?? null} avatarUrl={profile?.avatar_url ?? null} />
          <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Work profile</p><h2 className="mt-1 text-lg font-bold text-slate-950">Your operating defaults</h2></div><Building2 className="h-5 w-5 text-slate-400" /></div>
            <dl className="mt-5 divide-y divide-slate-100"><ProfileField icon={MapPin} label="Active hotel" value={hotel?.name ?? "No hotel assigned"} /><ProfileField icon={Clock3} label="Work time zone" value="Europe/London" /><ProfileField icon={Clock3} label="Time display" value="24-hour clock" /></dl>
            <p className="mt-4 text-sm leading-5 text-slate-500">Your active hotel can be changed from the shift overview when you are not running a task.</p>
          </section>
          <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Quick reference</p><h2 className="mt-1 text-lg font-bold text-slate-950">Cleaner system manual</h2><p className="mt-1 text-sm text-slate-600">Quick guidance for shift and task workflows.</p></div>
            <SystemManual role="cleaner" />
          </section>
          <div className="mt-5"><PayrollSummary logs={payroll ?? []} /></div>
          <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Account session</p><h2 className="mt-1 font-bold">Sign out of this device</h2><p className="mt-1 text-sm text-slate-500">Your shift and submitted work logs remain saved.</p></div>
            <SignOutButton />
          </section>
        </div>
      </main>
    );
  }

  const data = await getSettingsData();
  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <PersonalProfileSettings fullName={profile?.full_name ?? user.email} email={profile?.email ?? user.email} phoneNumber={profile?.phone_number ?? null} avatarUrl={profile?.avatar_url ?? null} />
        <UserSettingsClient actorRole={data.actorRole} actorName={data.actorName} actorEmail={data.actorEmail} actorAvatarUrl={data.actorAvatarUrl} hotels={data.hotels} users={data.users} />
        {data.actorRole === "admin" && <SystemAccessPanel users={data.users} permissions={data.permissions} />}
      </div>
    </main>
  );
}

function ProfileField({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="grid grid-cols-[1.25rem_7rem_1fr] items-center gap-3 py-3 text-sm"><Icon className="h-4 w-4 text-slate-400" /><dt className="text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value}</dd></div>;
}
