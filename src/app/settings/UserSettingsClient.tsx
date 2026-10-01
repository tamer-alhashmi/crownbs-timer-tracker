"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, ShieldAlert, Trash2, UserRound, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { assignManagedUserToHotel, createManagedUser, deleteManagedUser, unassignManagedUserFromHotel, updateManagedUser, type ManagedUser } from "./actions";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";

type Props = {
  actorRole: string;
  actorName: string;
  actorEmail: string;
  actorAvatarUrl: string | null;
  hotels: { id: string; name: string }[];
  users: ManagedUser[];
};
type FormState = {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: ManagedUser["role"];
  pinCode: string;
  hotelId: string;
  password: string;
};
type UnlinkTarget = { userId: string; userName: string; hotels: { id: string; name: string }[] };
const PAGE_SIZE = 10;
const emptyForm: FormState = { fullName: "", email: "", phoneNumber: "", role: "cleaner", pinCode: "", hotelId: "", password: "" };

export default function UserSettingsClient({ actorRole, actorName, actorEmail, actorAvatarUrl, hotels, users }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignmentHotelId, setAssignmentHotelId] = useState("");
  const [unlinkTarget, setUnlinkTarget] = useState<UnlinkTarget | null>(null);
  const [unlinkHotelId, setUnlinkHotelId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();
  const roles = actorRole === "admin" ? ["admin", "owner", "manager", "cleaner"] : actorRole === "owner" ? ["manager", "cleaner"] : ["cleaner"];
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => !query || `${user.full_name} ${user.email} ${user.phone_number ?? ""} ${user.role}`.toLowerCase().includes(query));
  }, [search, users]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const setField = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const save = () => startTransition(async () => {
    try {
      setMessage("");
      const wasEditing = Boolean(editingId);
      if (editingId) await updateManagedUser(editingId, form);
      else await createManagedUser(form);
      setForm(emptyForm);
      setEditingId(null);
      setMessage(wasEditing ? "User updated." : "User created.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save user.");
    }
  });

  const edit = (user: ManagedUser) => {
    setEditingId(user.id);
    setForm({
      fullName: user.full_name,
      email: user.email,
      phoneNumber: user.phone_number ?? "",
      role: user.role,
      pinCode: user.pin_code ?? "",
      hotelId: user.assignedHotels[0]?.id ?? user.primary_hotel_id ?? "",
      password: "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = (user: ManagedUser) => {
    if (!window.confirm(`Delete ${user.full_name}? This removes their login and work history.`)) return;
    startTransition(async () => {
      try {
        await deleteManagedUser(user.id);
        setMessage("User deleted.");
        window.location.reload();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to delete user.");
      }
    });
  };

  const assignHotel = (userId: string) => startTransition(async () => {
    try {
      if (!assignmentHotelId) throw new Error("Select a hotel first.");
      await assignManagedUserToHotel(userId, assignmentHotelId);
      setMessage("Hotel assignment updated.");
      setAssigningId(null);
      setAssignmentHotelId("");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to assign hotel.");
    }
  });

  const confirmUnlink = () => {
    if (!unlinkTarget || !unlinkHotelId) return;
    const target = unlinkTarget;
    const hotel = target.hotels.find((item) => item.id === unlinkHotelId);
    if (!hotel) return;
    startTransition(async () => {
      try {
        await unassignManagedUserFromHotel(target.userId, hotel.id);
        setUnlinkTarget(null);
        setMessage(`${hotel.name} was unlinked from ${target.userName}.`);
        window.location.reload();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to remove hotel assignment.");
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 p-3 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">{actorRole} settings</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-950 sm:text-3xl">User management</h1>
            <p className="mt-2 text-sm text-slate-600">Manage accounts and hotel assignments within your role scope.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={actorRole === "admin" ? "/admin" : actorRole === "owner" ? "/owner" : "/manager"} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to dashboard</a>
            <UserProfileMenu name={actorName} email={actorEmail} role={actorRole} avatarUrl={actorAvatarUrl} settingsHref="/settings" />
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-sky-100 p-2 text-sky-700"><UserRound className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{editingId ? "Edit user" : "Add user"}</h2>
              <p className="text-sm text-slate-500">Set contact details, account role, and hotel assignment.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input value={form.fullName} onChange={(event) => setField("fullName", event.target.value)} placeholder="Full name" autoComplete="name" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" />
            <input type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} placeholder="Email" autoComplete="email" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" />
            <input type="tel" value={form.phoneNumber} onChange={(event) => setField("phoneNumber", event.target.value)} placeholder="Phone number" autoComplete="tel" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" />
            <select value={form.role} onChange={(event) => setField("role", event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900">{roles.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select>
            <select value={form.hotelId} onChange={(event) => setField("hotelId", event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"><option value="">Unassigned hotel</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select>
            <input value={form.pinCode} onChange={(event) => setField("pinCode", event.target.value)} inputMode="numeric" maxLength={4} placeholder="4-digit PIN" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" />
            <input type="password" value={form.password} onChange={(event) => setField("password", event.target.value)} placeholder={editingId ? "New password (optional)" : "Password (optional with PIN)"} autoComplete="new-password" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 sm:col-span-2 lg:col-span-1" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={isPending} className="min-h-11 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Saving..." : editingId ? "Save changes" : "Create user"}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"><X className="h-4 w-4" /> Cancel edit</button>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div><h2 className="text-lg font-bold text-slate-900">Managed users</h2><p className="text-sm text-slate-500">{filteredUsers.length} matching {users.length} total accounts</p></div>
            <label className="relative block w-full md:max-w-sm">
              <span className="sr-only">Search users</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, phone, or role" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900" />
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 [-webkit-overflow-scrolling:touch]">
            <table className="min-w-[1050px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Phone number</th><th className="px-4 py-3">Assigned hotels</th><th className="px-4 py-3">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visibleUsers.map((user) => (
                  <tr key={user.id} className="align-top hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="flex min-w-56 items-center gap-3">
                        <UserAvatar name={user.full_name} avatarUrl={user.avatar_url} className="h-10 w-10 bg-sky-100 text-sm font-semibold text-sky-800" />
                        <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{user.full_name}</p><p className="max-w-56 truncate text-xs text-slate-500">{user.email}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">{user.role}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{user.phone_number || <span className="text-slate-400">Not provided</span>}</td>
                    <td className="max-w-64 px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">{user.assignedHotels.length ? user.assignedHotels.map((hotel) => <span key={hotel.id} className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">{hotel.name}</span>) : <span className="text-xs text-slate-500">No assigned hotel</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-64 flex-wrap gap-1.5">
                        <button type="button" onClick={() => { setAssigningId(assigningId === user.id ? null : user.id); setAssignmentHotelId(""); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-sky-200 bg-white px-2.5 py-2 text-xs font-semibold text-sky-800"><Plus className="h-3.5 w-3.5" /> Assign hotel</button>
                        {user.assignedHotels.length > 0 && <button type="button" onClick={() => { setUnlinkTarget({ userId: user.id, userName: user.full_name, hotels: user.assignedHotels }); setUnlinkHotelId(user.assignedHotels[0].id); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs font-semibold text-amber-800"><ShieldAlert className="h-3.5 w-3.5" /> Unlink</button>}
                        <button type="button" onClick={() => edit(user)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        {actorRole === "admin" && <button type="button" onClick={() => remove(user)} disabled={isPending} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
                      </div>
                      {assigningId === user.id && <div className="mt-2 flex min-w-64 flex-col gap-2 rounded-xl border border-sky-100 bg-sky-50 p-2 sm:flex-row">
                        <select value={assignmentHotelId} onChange={(event) => setAssignmentHotelId(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-2 text-xs text-slate-900"><option value="">Select hotel</option>{hotels.filter((hotel) => !user.assignedHotels.some((assigned) => assigned.id === hotel.id)).map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select>
                        <button type="button" onClick={() => assignHotel(user.id)} disabled={isPending} className="min-h-10 rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Assign</button>
                      </div>}
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No users match your search.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Showing {visibleUsers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length} accounts</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span className="px-2 text-sm text-slate-600">Page {currentPage} of {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount} aria-label="Next page" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>
        {message && <p role="status" className="mt-4 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{message}</p>}
        {unlinkTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="unlink-title"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start gap-3"><div className="rounded-xl bg-amber-100 p-2 text-amber-700"><ShieldAlert className="h-5 w-5" /></div><div className="min-w-0"><h2 id="unlink-title" className="text-lg font-bold text-slate-900">Unlink hotel?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Are you sure you want to unlink this hotel from <strong>{unlinkTarget.userName}</strong>?</p><select value={unlinkHotelId} onChange={(event) => setUnlinkHotelId(event.target.value)} className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900">{unlinkTarget.hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><p className="mt-2 text-xs text-slate-500">This changes the user&apos;s property access but does not delete the hotel or work history.</p></div></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setUnlinkTarget(null)} disabled={isPending} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={confirmUnlink} disabled={isPending} className="min-h-11 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Unlinking..." : "Confirm unlink"}</button></div></div></div>}
      </div>
    </main>
  );
}
