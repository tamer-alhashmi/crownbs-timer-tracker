"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Pencil, Plus, Search, ShieldAlert, UserPlus, UserX, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { assignManagedUserToHotel, createManagedUser, deleteManagedUser, setManagedUserPin, unassignManagedUserFromHotel, updateManagedUser, type ManagedUser } from "./actions";
import { normalizeUserRole, ROLE_LABELS, USER_ROLES } from "@/lib/roles";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import { showActionToast } from "@/components/ui/ActionToast";
import { isPlatformAdmin } from "@/lib/roles";
import { ActionErrorMessage } from "@/components/ui/ActionErrorMessage";
import { formatUserMessage } from "@/lib/userMessages";

type Props = {
  actorRole: string;
  hotels: { id: string; name: string }[];
  users: ManagedUser[];
};
type FormState = {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: (typeof USER_ROLES)[number];
  pinCode: string;
  hotelIds: string[];
  primaryHotelId: string;
  password: string;
};
type UnlinkTarget = { userId: string; userName: string; hotels: { id: string; name: string }[] };
const PAGE_SIZE = 10;
const emptyForm: FormState = { fullName: "", email: "", phoneNumber: "", role: "cleaner", pinCode: "", hotelIds: [], primaryHotelId: "", password: "" };
function getAssignmentErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "error" in error) {
    return formatUserMessage(error.error, "Failed to assign property.");
  }
  return formatUserMessage(error, "Failed to assign property.");
}

const userSchema = z.object({
  fullName: z.string().trim().min(1, "Enter a full name.").max(120),
  email: z.string().trim().email("Enter a valid email address."),
  phoneNumber: z.string().trim().max(32).refine((value) => !value || /^[+()\d\s.-]{5,32}$/.test(value), "Enter a valid phone number or leave it blank."),
  role: z.enum(USER_ROLES),
  pinCode: z.string().refine((value) => !value || /^\d{4}$/.test(value), "PIN must be exactly 4 digits."),
  hotelIds: z.array(z.string()),
  primaryHotelId: z.string(),
  password: z.string().max(128),
});

export default function UserSettingsClient({ actorRole, hotels, users }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignmentHotelId, setAssignmentHotelId] = useState("");
  const [unlinkTarget, setUnlinkTarget] = useState<UnlinkTarget | null>(null);
  const [unlinkHotelId, setUnlinkHotelId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormState>({ resolver: zodResolver(userSchema), defaultValues: emptyForm });
  const emailRegistration = form.register("email");
  const selectedHotelIds = useWatch({ control: form.control, name: "hotelIds" });
  const primaryHotelId = useWatch({ control: form.control, name: "primaryHotelId" });
  const roles = USER_ROLES.filter((role) => (
    (isPlatformAdmin(actorRole) && (actorRole === "super_admin" || role !== "super_admin")) ||
    (actorRole === "owner" && ["manager", "housekeeping_admin", "cleaner"].includes(role)) ||
    (actorRole === "manager" && ["housekeeping_admin", "cleaner"].includes(role))
  ));
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const roleOrder: Record<string, number> = { manager: 0, housekeeping_admin: 1, hk_admin: 1, cleaner: 2, owner: 3, admin: 4, super_admin: 5 };
    return users
      .filter((user) => (propertyFilter === "all" || user.assignedHotels.some((hotel) => hotel.id === propertyFilter))
        && (!query || `${user.full_name} ${user.email} ${user.phone_number ?? ""} ${user.role}`.toLowerCase().includes(query)))
      .sort((left, right) => (roleOrder[left.role] ?? 10) - (roleOrder[right.role] ?? 10) || left.full_name.localeCompare(right.full_name));
  }, [propertyFilter, search, users]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const editingUser = users.find((user) => user.id === editingId);
  const save = form.handleSubmit((values) => startTransition(async () => {
    try {
      setMessage("");
      setMessageIsError(false);
      if (values.hotelIds.length && !values.hotelIds.includes(values.primaryHotelId)) {
        const errorMessage = "Choose a primary property from the assigned properties.";
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      if (values.hotelIds.length > 1 && !values.primaryHotelId) {
        const errorMessage = "Choose one assigned property as the primary property.";
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      if (!editingId && !values.password.trim() && !values.pinCode) {
        const errorMessage = "Provide a password or a 4-digit PIN.";
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      const wasEditing = Boolean(editingId);
      const result = editingId
        ? await updateManagedUser(editingId, values)
        : await createManagedUser(values);
      if (!result.success) {
        if (/already in use|already exists|already registered|users_email_unique/i.test(result.error)) {
          form.setError("email", {
            type: "server",
            message: "This email address is already registered. Please choose another one.",
          });
          setMessage("This email address is already registered. Please choose another one.");
          setMessageIsError(true);
          showActionToast("error", "This email address is already registered.");
          return;
        }
        const errorMessage = wasEditing
          ? "Unable to update user. Please review the details and try again."
          : "Unable to create user. Please review the details and try again.";
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      form.reset(emptyForm);
      setEditingId(null);
      setIsAccordionOpen(false);
      setPropertySearch("");
      setMessage("");
      setMessageIsError(false);
      showActionToast("success", wasEditing ? "User updated successfully." : "User account created successfully.");
      router.refresh();
    } catch (error) {
      console.error("Managed user save failed:", error);
      const errorMessage = editingId
        ? "Unable to update user. Please review the details and try again."
        : "Unable to create user. Please review the details and try again.";
      setMessage(errorMessage);
      setMessageIsError(true);
      showActionToast("error", errorMessage);
    }
  }));

  const edit = (user: ManagedUser) => {
    setEditingId(user.id);
    setPropertySearch("");
    setMessage("");
    setMessageIsError(false);
    form.reset({
      fullName: user.full_name,
      email: user.email,
      phoneNumber: user.phone_number ?? "",
      role: normalizeUserRole(user.role),
      pinCode: "",
      hotelIds: user.assignedHotels.map((hotel) => hotel.id),
      primaryHotelId: user.primary_hotel_id ?? user.assignedHotels[0]?.id ?? "",
      password: "",
    });
    setIsAccordionOpen(true);
  };

  const closeUserForm = () => {
    if (isPending) return;
    setIsAccordionOpen(false);
    setEditingId(null);
    setPropertySearch("");
    setMessage("");
    setMessageIsError(false);
    form.reset(emptyForm);
  };

  const openCreateUserForm = () => {
    setEditingId(null);
    setMessage("");
    setMessageIsError(false);
    setPropertySearch("");
    form.reset(emptyForm);
    setIsAccordionOpen(true);
  };

  const toggleCreateUserForm = () => {
    if (isAccordionOpen) {
      closeUserForm();
      return;
    }
    openCreateUserForm();
  };

  const setHotelSelection = (hotelIds: string[]) => {
    const uniqueHotelIds = [...new Set(hotelIds)];
    const currentPrimaryHotelId = form.getValues("primaryHotelId");
    form.setValue("hotelIds", uniqueHotelIds, { shouldDirty: true, shouldValidate: true });
    if (!uniqueHotelIds.includes(currentPrimaryHotelId)) {
      form.setValue("primaryHotelId", uniqueHotelIds[0] ?? "", { shouldDirty: true, shouldValidate: true });
    }
  };

  const toggleHotelSelection = (hotelId: string) => {
    const currentHotelIds = form.getValues("hotelIds");
    setHotelSelection(currentHotelIds.includes(hotelId)
      ? currentHotelIds.filter((id) => id !== hotelId)
      : [...currentHotelIds, hotelId]);
  };

  const deactivate = (user: ManagedUser) => {
    if (!window.confirm(`Deactivate ${user.full_name}? Their work logs and audit history will be retained.`)) return;
    startTransition(async () => {
      try {
        await deleteManagedUser(user.id);
        setMessage("User deactivated. Historical records were retained.");
        setMessageIsError(false);
        showActionToast("success", `${user.full_name} deactivated.`);
        router.refresh();
      } catch (error) {
        const message = formatUserMessage(error, "Unable to deactivate user.");
        setMessage(message);
        setMessageIsError(true);
        showActionToast("error", message);
      }
    });
  };

  const assignHotel = (userId: string) => startTransition(async () => {
    try {
      if (!assignmentHotelId) {
        const errorMessage = "Select a property first.";
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      const result = await assignManagedUserToHotel(userId, assignmentHotelId);
      if (!result.success) {
        const errorMessage = getAssignmentErrorMessage(result.error);
        setMessage(errorMessage);
        setMessageIsError(true);
        showActionToast("error", errorMessage);
        return;
      }
      const user = users.find((item) => item.id === userId);
      const hotel = hotels.find((item) => item.id === assignmentHotelId);
      setMessage("Property assignment updated.");
      setMessageIsError(false);
      showActionToast("success", `${hotel?.name ?? "Property"} assigned to ${user?.full_name ?? "user"}.`);
      setAssigningId(null);
      setAssignmentHotelId("");
      router.refresh();
    } catch (error) {
      const errorMessage = getAssignmentErrorMessage(error);
      setMessage(errorMessage);
      setMessageIsError(true);
      showActionToast("error", errorMessage);
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
        setMessageIsError(false);
        showActionToast("success", `${hotel.name} unlinked from ${target.userName}.`);
        router.refresh();
      } catch (error) {
        const message = formatUserMessage(error, "Unable to remove hotel assignment.");
        setMessage(message);
        setMessageIsError(true);
        showActionToast("error", message);
      }
    });
  };

  return (
    <section className="space-y-5 p-1 text-ink sm:p-2">
      <div className="mx-auto max-w-7xl">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md">
          <button
            type="button"
            aria-expanded={isAccordionOpen}
            aria-controls="managed-user-form"
            onClick={toggleCreateUserForm}
            className="flex min-h-20 w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-surface-secondary active:scale-[0.99] sm:px-6"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><UserPlus className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{editingId ? "Edit User" : "Add New User"}</span>
                <span className="mt-0.5 block text-sm text-ink-secondary">{editingId ? "Update account details and property permissions" : "Create account, assign role, and set property permissions"}</span>
              </span>
            </span>
            <span className="shrink-0 text-ink-secondary">{isAccordionOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
          </button>
          <div id="managed-user-form" aria-hidden={!isAccordionOpen} inert={!isAccordionOpen} className={`overflow-hidden transition-all duration-300 ease-in-out ${isAccordionOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
            <form onSubmit={save} noValidate className="space-y-4 border-t border-line bg-surface-secondary p-4 sm:p-6">
              <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-4"><h3 className="font-semibold text-ink">Personal &amp; Access</h3><p className="mt-1 text-xs text-ink-secondary">Contact information and access role.</p></div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field label="Full name" error={form.formState.errors.fullName?.message}><input {...form.register("fullName")} placeholder="Full name" autoComplete="name" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></Field>
                  <Field label="Email" error={form.formState.errors.email?.message}><input {...emailRegistration} onChange={(event) => { form.clearErrors("email"); void emailRegistration.onChange(event); }} type="email" placeholder="Email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} className={`mt-1 min-h-11 w-full rounded-xl border bg-surface px-3 py-2.5 text-sm text-ink ${form.formState.errors.email ? "border-rose-500 focus:border-rose-500 focus:outline-rose-500" : "border-line"}`} /></Field>
                  <Field label="Phone number" error={form.formState.errors.phoneNumber?.message}><input {...form.register("phoneNumber")} type="tel" placeholder="Phone number" autoComplete="tel" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></Field>
                </div>
                <div className="mt-4 max-w-md">
                  <Field label="Role" error={form.formState.errors.role?.message}><select {...form.register("role")} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink">{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Field>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-3"><h3 className="font-semibold text-ink">Property assignments</h3><p className="mt-1 text-xs text-ink-secondary">Select the properties this user can access and choose a primary property.</p></div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedHotelIds.length ? selectedHotelIds.map((hotelId) => {
                    const hotel = hotels.find((item) => item.id === hotelId);
                    if (!hotel) return null;
                    return <span key={hotel.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 py-1 pl-3 pr-1 text-xs font-medium text-accent">
                      <span className="max-w-56 truncate">{hotel.name}</span>
                      <button type="button" aria-label={`Remove ${hotel.name}`} onClick={() => toggleHotelSelection(hotel.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-accent/10"><X className="h-3.5 w-3.5" /></button>
                    </span>;
                  }) : <span className="text-xs text-ink-secondary">No properties selected.</span>}
                </div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-ink-secondary">{selectedHotelIds.length} of {hotels.length} selected</span>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setHotelSelection(hotels.map((hotel) => hotel.id))} className="text-xs font-semibold text-accent hover:text-ink">Select All</button>
                    <button type="button" onClick={() => setHotelSelection([])} className="text-xs font-semibold text-ink-secondary hover:text-ink">Clear All</button>
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-line p-3">
                  <label className="sticky top-0 z-10 mb-2 block bg-surface pb-2">
                    <span className="sr-only">Filter properties</span>
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" />
                    <input value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="Filter properties..." className="min-h-10 w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
                  </label>
                  <div className="space-y-1">
                    {hotels.filter((hotel) => hotel.name.toLowerCase().includes(propertySearch.trim().toLowerCase())).map((hotel) => {
                      const assigned = selectedHotelIds.includes(hotel.id);
                      return <div key={hotel.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${assigned ? "bg-accent/10" : "hover:bg-surface-secondary"}`}>
                        <input id={`assign-${hotel.id}`} type="checkbox" checked={assigned} onChange={() => toggleHotelSelection(hotel.id)} className="h-4 w-4 rounded border-line text-accent focus:ring-accent" />
                        <label htmlFor={`assign-${hotel.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm text-ink">{hotel.name}</label>
                        {assigned && <label className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent"><input type="radio" name="primaryHotel" checked={primaryHotelId === hotel.id} onChange={() => form.setValue("primaryHotelId", hotel.id, { shouldDirty: true, shouldValidate: true })} aria-label={`${hotel.name} is primary property`} />Primary</label>}
                        {assigned && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
                      </div>;
                    })}
                    {hotels.filter((hotel) => hotel.name.toLowerCase().includes(propertySearch.trim().toLowerCase())).length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-secondary">No properties match your filter.</p>}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-4"><h3 className="font-semibold text-ink">Credentials</h3><p className="mt-1 text-xs text-ink-secondary">Set a PIN or password for account access.</p></div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="4-digit PIN" error={form.formState.errors.pinCode?.message}><input {...form.register("pinCode")} inputMode="numeric" maxLength={4} placeholder={editingId ? "Leave blank to keep current PIN" : "PIN"} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink" />{editingId && <span className="mt-1 block text-xs text-ink-secondary">{editingUser?.hasPin ? "PIN is set. Enter a new PIN to replace it." : "No PIN is currently set."}</span>}</Field>
                  <Field label="Password" error={form.formState.errors.password?.message}><input {...form.register("password")} type="password" placeholder={editingId ? "New password (optional)" : "Password (optional with PIN)"} autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></Field>
                </div>
                {editingId && editingUser?.hasPin && <button type="button" disabled={isPending} onClick={() => startTransition(async () => {
                  try {
                    await setManagedUserPin(editingId, null);
                    showActionToast("success", "PIN removed.");
                    router.refresh();
                  } catch (error) {
                    const errorMessage = formatUserMessage(error, "Unable to remove the PIN.");
                    setMessage(errorMessage);
                    setMessageIsError(true);
                    showActionToast("error", errorMessage);
                  }
                })} className="mt-3 min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Remove PIN</button>}
              </section>
              {message && <ActionErrorMessage error={message} onDismiss={() => setMessage("")} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeUserForm} disabled={isPending} className="min-h-11 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-secondary disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{editingId ? "Saving..." : "Creating..."}</> : editingId ? "Save changes" : "Create user"}
                </button>
              </div>
            </form>
          </div>
        </div>

        <section id="managed-users" className="scroll-mt-24 rounded-2xl border border-line/80 bg-surface p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-lg font-bold text-ink">Managed users</h2><p className="text-sm text-ink-secondary">{filteredUsers.length} matching {users.length} total accounts</p></div>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(15rem,0.7fr)_minmax(15rem,1fr)]">
            <p className="text-sm font-medium text-ink-secondary">Search and manage user access</p>
            <label className="block text-xs font-semibold text-ink-secondary">
              Property
              <select value={propertyFilter} onChange={(event) => { setPropertyFilter(event.target.value); setPage(1); }} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-secondary px-3 text-sm text-ink">
                <option value="all">All Properties</option>
                {hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
              </select>
            </label>
            <label className="relative block w-full md:max-w-sm">
              <span className="sr-only">Search users</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, phone, or role" className="min-h-11 w-full rounded-xl border border-line bg-surface-secondary py-2.5 pl-9 pr-3 text-sm text-ink" />
            </label>
          </div>
          {propertyFilter !== "all" && !filteredUsers.some((user) => ["housekeeping_admin", "hk_admin"].includes(user.role)) && (
            <button type="button" onClick={() => {
              openCreateUserForm();
              form.setValue("role", "housekeeping_admin");
              form.setValue("hotelIds", [propertyFilter]);
              form.setValue("primaryHotelId", propertyFilter);
            }} className="mb-3 flex min-h-14 w-full items-center justify-between rounded-xl border border-dashed border-accent/50 bg-accent/5 px-4 text-left text-sm font-semibold text-accent hover:bg-accent/10">
              No Housekeeping Leader assigned - Click to assign <UserPlus className="h-4 w-4" />
            </button>
          )}
          <div className="space-y-2">
            {visibleUsers.map((user) => (
              <article key={user.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                <button type="button" aria-expanded={expandedUserId === user.id} onClick={() => setExpandedUserId((current) => current === user.id ? null : user.id)} className="flex min-h-14 w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-surface-secondary sm:gap-3 sm:px-4">
                  <UserAvatar name={user.full_name} avatarUrl={user.avatar_url} role={user.role} className="h-8 w-8 shrink-0 bg-accent/10 text-xs font-semibold text-accent" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{user.full_name}</span><span className="block truncate text-xs text-ink-secondary">{user.email}</span></span>
                  <span className="hidden shrink-0 rounded-full bg-surface-secondary px-2 py-1 text-[11px] font-semibold text-ink-secondary sm:inline-flex">{ROLE_LABELS[user.role]}</span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${user.is_clocked_in ? "bg-emerald-500" : "bg-ink-muted/40"}`} title={user.is_clocked_in ? "On active shift" : "Not on shift"} />
                  <span className="hidden max-w-36 truncate rounded-full bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent sm:inline-flex">{user.assignedHotels.find((hotel) => hotel.id === propertyFilter)?.name ?? user.assignedHotels[0]?.name ?? "Unassigned"}</span>
                  {expandedUserId === user.id ? <ChevronUp className="h-4 w-4 shrink-0 text-ink-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" />}
                </button>
                {expandedUserId === user.id && <div className="border-t border-line bg-surface-secondary/50 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-semibold text-ink-secondary">{ROLE_LABELS[user.role]}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.is_active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>{user.is_active ? "Active" : "Deactivated"}</span>
                    <LiveStatusIndicator isClockedIn={user.is_clocked_in ?? false} className="text-xs" />
                    {user.phone_number && <span className="text-xs text-ink-secondary">{user.phone_number}</span>}
                  </div>
                  <div className="mt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">Assigned properties</p><div className="flex flex-wrap gap-1.5">
                    {user.assignedHotels.length ? user.assignedHotels.map((hotel) => <span key={hotel.id} className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">{hotel.name}</span>) : <span className="text-xs text-ink-secondary">No assigned property</span>}
                  </div></div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => { setAssigningId(assigningId === user.id ? null : user.id); setAssignmentHotelId(""); }} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-accent/30 bg-surface px-3 text-xs font-semibold text-accent"><Plus className="h-4 w-4" /> Assign hotel</button>
                    {user.assignedHotels.length > 0 && <button type="button" onClick={() => { setUnlinkTarget({ userId: user.id, userName: user.full_name, hotels: user.assignedHotels }); setUnlinkHotelId(user.assignedHotels[0].id); }} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-500/30 bg-surface px-3 text-xs font-semibold text-amber-700 dark:text-amber-300"><ShieldAlert className="h-3.5 w-3.5" /> Unlink</button>}
                    <button type="button" onClick={() => edit(user)} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-secondary"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                    {actorRole === "super_admin" && user.is_active && <button type="button" onClick={() => deactivate(user)} disabled={isPending} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-rose-500/30 bg-surface px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"><UserX className="h-4 w-4" /> Deactivate</button>}
                  </div>
                  {assigningId === user.id && <div className="mt-3 flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3 sm:flex-row">
                    <select value={assignmentHotelId} onChange={(event) => setAssignmentHotelId(event.target.value)} className="min-h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm text-ink sm:flex-1"><option value="">Select hotel</option>{hotels.filter((hotel) => !user.assignedHotels.some((assigned) => assigned.id === hotel.id)).map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select>
                    <button type="button" onClick={() => assignHotel(user.id)} disabled={isPending} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Assign</button>
                  </div>}
                </div>}
              </article>
            ))}
            {visibleUsers.length === 0 && <p className="rounded-xl border border-line px-4 py-8 text-center text-sm text-ink-secondary">No users match your search.</p>}
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-secondary">Showing {visibleUsers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length} accounts</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page" className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink-secondary disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span className="px-2 text-sm text-ink-secondary">Page {currentPage} of {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount} aria-label="Next page" className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink-secondary disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>
        {message && !isAccordionOpen && (messageIsError
          ? <ActionErrorMessage error={message} onDismiss={() => setMessage("")} className="mt-4" />
          : <p role="status" className="mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-secondary">{message}</p>)}
        {unlinkTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="unlink-title"><div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"><div className="flex items-start gap-3"><div className="rounded-xl bg-amber-100 p-2 text-amber-700"><ShieldAlert className="h-5 w-5" /></div><div className="min-w-0"><h2 id="unlink-title" className="text-lg font-bold text-ink">Unlink hotel?</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">Are you sure you want to unlink this hotel from <strong>{unlinkTarget.userName}</strong>?</p><select value={unlinkHotelId} onChange={(event) => setUnlinkHotelId(event.target.value)} className="mt-3 min-h-11 w-full rounded-xl border border-line bg-surface-secondary px-3 py-2.5 text-sm text-ink">{unlinkTarget.hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><p className="mt-2 text-xs text-ink-secondary">This changes the user&apos;s property access but does not delete the hotel or work history.</p></div></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setUnlinkTarget(null)} disabled={isPending} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-secondary">Cancel</button><button type="button" onClick={confirmUnlink} disabled={isPending} className="min-h-11 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Unlinking..." : "Confirm unlink"}</button></div></div></div>}
      </div>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-ink-secondary">{label}{children}{error && <span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>}</label>;
}
