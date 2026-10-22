import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { PayrollSummary } from "@/components/dashboard/PayrollSummary";
import { SystemManual } from "@/components/dashboard/SystemManual";
import { getSettingsData } from "./actions";
import UserSettingsClient from "./UserSettingsClient";
import SystemAccessPanel from "./SystemAccessPanel";
import PersonalProfileSettings from "./PersonalProfileSettings";
import SettingsHub from "./SettingsHub";
import { PropertySettings } from "./AssetSettings";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("full_name, email, phone_number, avatar_url, language_preference")
    .eq("id", user.userId)
    .maybeSingle();
  if (profileError) throw new Error(`Unable to load profile settings: ${profileError.message}`);
  const name = profile?.full_name ?? user.email;
  const backHref = user.role === "cleaner" ? "/dashboard" : user.role === "owner" ? "/owner" : user.role === "manager" ? "/manager" : user.role === "hk_admin" ? "/hk-admin" : "/admin";
  const utility = (
    <>
      <Link href={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Dashboard</span></Link>
      <UserProfileMenu name={name} email={profile?.email ?? user.email} avatarUrl={profile?.avatar_url ?? null} role={user.role} settingsHref="/settings" />
    </>
  );

  if (user.role === "cleaner") {
    const [, { data: payroll }] = await Promise.all([
      user.hotelId ? supabase.from("hotels").select("name, location").eq("id", user.hotelId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("work_logs").select("id, start_time, end_time, task_date, rooms_completed, is_locked, cost_override, deleted_at, cancelled_at, services_config(name, default_rate, unit)").eq("user_id", user.userId).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null).order("start_time", { ascending: false }),
    ]);
    return (
      <SettingsHub
        role={user.role}
        utility={utility}
        profile={<div className="mx-auto max-w-5xl">
          <PersonalProfileSettings fullName={name} email={profile?.email ?? user.email} phoneNumber={profile?.phone_number ?? null} avatarUrl={profile?.avatar_url ?? null} languagePreference={profile?.language_preference ?? "en"} role={user.role} />
          <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Quick reference</p><h2 className="mt-1 text-lg font-bold text-slate-950">Cleaner system manual</h2><p className="mt-1 text-sm text-slate-600">Quick guidance for shift and task workflows.</p></div>
            <SystemManual role="cleaner" />
          </section>
          <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Account session</p><h2 className="mt-1 font-bold">Sign out of this device</h2><p className="mt-1 text-sm text-slate-500">Your shift and submitted work logs remain saved.</p></div>
            <SignOutButton />
          </section>
        </div>}
        payroll={<div className="mx-auto max-w-5xl"><PayrollSummary logs={payroll ?? []} /></div>}
        users={null}
        properties={null}
      />
    );
  }

  if (user.role === "hk_admin") {
    return (
      <SettingsHub
        role={user.role}
        utility={utility}
        profile={<PersonalProfileSettings fullName={name} email={profile?.email ?? user.email} phoneNumber={profile?.phone_number ?? null} avatarUrl={profile?.avatar_url ?? null} languagePreference={profile?.language_preference ?? "en"} role={user.role} />}
        users={null}
        properties={null}
      />
    );
  }

  const data = await getSettingsData();
  return (
    <SettingsHub
      role={data.actorRole}
      utility={utility}
      profile={<PersonalProfileSettings fullName={profile?.full_name ?? user.email} email={profile?.email ?? user.email} phoneNumber={profile?.phone_number ?? null} avatarUrl={profile?.avatar_url ?? null} languagePreference={profile?.language_preference ?? "en"} role={user.role} />}
      users={<><UserSettingsClient actorRole={data.actorRole} hotels={data.hotels} users={data.users} />{data.actorRole === "admin" && <SystemAccessPanel users={data.users} permissions={data.permissions} />}</>}
      properties={<PropertySettings properties={data.properties} managers={data.managers} />}
    />
  );
}
