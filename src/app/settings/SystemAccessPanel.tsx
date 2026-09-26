"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, LoaderCircle, ShieldCheck } from "lucide-react";
import { updateUserFeaturePermissions, type ManagedUser } from "./actions";
import { FEATURE_KEYS, type FeatureKey, type FeaturePermission } from "./permissionConfig";

type Props = { users: ManagedUser[]; permissions: FeaturePermission[] };
type Access = Pick<FeaturePermission, "can_view" | "can_create" | "can_edit" | "can_delete">;

const labels: Record<FeatureKey, string> = {
  dashboard: "Dashboard",
  work_log_approvals: "Work log approvals",
  payroll: "Payroll",
  rooms: "Room management",
  historical_import: "Historical import",
  user_management: "User management",
  settings: "Settings",
};

const emptyAccess: Access = { can_view: false, can_create: false, can_edit: false, can_delete: false };
const roleDefaults: Record<ManagedUser["role"], Partial<Record<FeatureKey, Access>>> = {
  admin: Object.fromEntries(FEATURE_KEYS.map((feature) => [feature, { can_view: true, can_create: true, can_edit: true, can_delete: true }])) as Partial<Record<FeatureKey, Access>>,
  owner: {
    dashboard: { can_view: true, can_create: false, can_edit: false, can_delete: false },
    work_log_approvals: { can_view: true, can_create: false, can_edit: true, can_delete: false },
    payroll: { can_view: true, can_create: false, can_edit: false, can_delete: false },
    rooms: { can_view: true, can_create: true, can_edit: true, can_delete: true },
    user_management: { can_view: true, can_create: true, can_edit: true, can_delete: true },
    settings: { can_view: true, can_create: false, can_edit: true, can_delete: false },
  },
  manager: {
    dashboard: { can_view: true, can_create: false, can_edit: false, can_delete: false },
    work_log_approvals: { can_view: true, can_create: false, can_edit: true, can_delete: false },
    payroll: { can_view: true, can_create: false, can_edit: false, can_delete: false },
    rooms: { can_view: true, can_create: true, can_edit: true, can_delete: true },
    user_management: { can_view: true, can_create: true, can_edit: true, can_delete: true },
    settings: { can_view: true, can_create: false, can_edit: true, can_delete: false },
  },
  cleaner: { dashboard: { can_view: true, can_create: true, can_edit: true, can_delete: false } },
};

export default function SystemAccessPanel({ users, permissions }: Props) {
  const managedUsers = users.filter((user) => user.role !== "admin");
  const initialUser = managedUsers[0];
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(initialUser?.id ?? "");
  const [draft, setDraft] = useState<Record<FeatureKey, Access>>(() => buildDraft(permissions, initialUser?.id ?? "", initialUser?.role ?? "cleaner"));
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedUser = managedUsers.find((user) => user.id === selectedUserId);
  const permissionRows = useMemo(() => FEATURE_KEYS.map((featureKey) => ({ featureKey, ...draft[featureKey] })), [draft]);

  const selectUser = (userId: string) => {
    const user = managedUsers.find((item) => item.id === userId);
    setSelectedUserId(userId);
    setDraft(buildDraft(permissions, userId, user?.role ?? "cleaner"));
    setNotice(null);
  };

  const toggle = (featureKey: FeatureKey, field: keyof Access) => {
    setDraft((current) => ({ ...current, [featureKey]: { ...current[featureKey], [field]: !current[featureKey][field] } }));
    setNotice(null);
  };

  const save = () => {
    if (!selectedUserId) {
      setNotice({ kind: "error", text: "Select a user before saving permissions." });
      return;
    }
    startTransition(async () => {
      try {
        setNotice(null);
        await updateUserFeaturePermissions(selectedUserId, permissionRows.map(({ featureKey, ...access }) => ({ feature_key: featureKey, ...access })));
        setNotice({ kind: "success", text: `Permissions saved for ${selectedUser?.full_name ?? "the selected user"}.` });
      } catch (error) {
        setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to save feature permissions." });
      }
    });
  };

  return <main className="min-h-0 bg-slate-100 px-3 pb-8 sm:px-6"><div className="mx-auto max-w-6xl"><section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Admin system control</p><h2 className="text-xl font-bold text-slate-900">Feature access</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Control what each user can see and change. Role and hotel ownership rules remain a second security boundary.</p></div></div><button type="button" onClick={() => { setIsOpen((value) => !value); setNotice(null); }} aria-expanded={isOpen} aria-controls="feature-access-configuration" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">{isOpen ? "Hide configuration" : "Configure permissions"}<ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} /></button></div>

    <div id="feature-access-configuration" aria-hidden={!isOpen} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isOpen ? "mt-5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className="border-t border-slate-100 pt-5">
      {managedUsers.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No non-administrator user accounts are available to configure.</div> : <><div className="max-w-md"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="permission-user">User account</label><select id="permission-user" value={selectedUserId} onChange={(event) => selectUser(event.target.value)} disabled={isPending} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900"><option value="" disabled>Select a user</option>{managedUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name} - {user.role}</option>)}</select></div>{selectedUser && <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200"><table className="min-w-[680px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Feature</th><th className="px-4 py-3 text-center">View</th><th className="px-4 py-3 text-center">Create</th><th className="px-4 py-3 text-center">Edit</th><th className="px-4 py-3 text-center">Delete</th></tr></thead><tbody className="divide-y divide-slate-100">{permissionRows.map((row) => <tr key={row.featureKey}><td className="px-4 py-3 font-medium text-slate-800">{labels[row.featureKey]}</td>{(["can_view", "can_create", "can_edit", "can_delete"] as const).map((field) => <td key={field} className="px-4 py-3 text-center"><input type="checkbox" checked={row[field]} onChange={() => toggle(row.featureKey, field)} disabled={isPending} aria-label={`${labels[row.featureKey]} ${field.replace("can_", "")}`} className="h-4 w-4 accent-sky-600" /></td>)}</tr>)}</tbody></table></div>}<div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Permissions are saved for the selected account only.</p><button type="button" onClick={save} disabled={isPending || !selectedUserId} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Saving...</> : <><Check className="h-4 w-4" /> Save access</>}</button></div></>}
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-xl px-3 py-2.5 text-sm ${notice.kind === "error" ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"}`}>{notice.text}</p>}
    </div></div></div>
  </section></div></main>;
}

function buildDraft(permissions: FeaturePermission[], userId: string, role: ManagedUser["role"]) {
  return FEATURE_KEYS.reduce<Record<FeatureKey, Access>>((draft, featureKey) => {
    const permission = permissions.find((item) => item.user_id === userId && item.feature_key === featureKey);
    draft[featureKey] = permission ? { can_view: permission.can_view, can_create: permission.can_create, can_edit: permission.can_edit, can_delete: permission.can_delete } : { ...emptyAccess, ...(roleDefaults[role][featureKey] ?? {}) };
    return draft;
  }, {} as Record<FeatureKey, Access>);
}
