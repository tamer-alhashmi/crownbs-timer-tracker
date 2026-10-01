"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { SignOutButton } from "./SignOutButton";
import { NotificationBell } from "@/components/chat/NotificationBell";
import { UserAvatar } from "@/components/shared/UserAvatar";

type Props = { name: string; email: string; role: string; settingsHref: string; avatarUrl?: string | null };

export function UserProfileMenu({ name, email, role, settingsHref, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 16 });

  useEffect(() => {
    if (!open) return;
    const closeMenu = () => setOpen(false);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [open]);

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (!open) {
      const trigger = event.currentTarget.getBoundingClientRect();
      const panelWidth = Math.max(0, Math.min(288, window.innerWidth - 32));
      const maxRight = Math.max(16, window.innerWidth - panelWidth - 16);
      const right = Math.max(16, Math.min(maxRight, window.innerWidth - trigger.right));
      setMenuPosition({ top: trigger.bottom + 8, right });
    }
    setOpen((value) => !value);
  };

  return <div className="relative z-50 flex items-center gap-2 overflow-visible">
    <NotificationBell />
    <button type="button" onClick={toggleMenu} aria-expanded={open} aria-haspopup="menu" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
      <UserAvatar name={name} avatarUrl={avatarUrl} className="h-8 w-8 bg-sky-100 text-sm text-sky-800" />
      <span className="hidden max-w-32 truncate sm:block">{name}</span>
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div role="menu" style={menuPosition} className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl">
      <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2"><UserAvatar name={name} avatarUrl={avatarUrl} className="h-10 w-10 bg-sky-100 text-base text-sky-800" /><div className="min-w-0"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-slate-500">{email}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">{role}</p></div></div>
      <a href={settingsHref} role="menuitem" className="mt-2 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings className="h-4 w-4 shrink-0" /><span className="truncate">Settings and preferences</span></a>
      <div className="mt-1 border-t border-slate-100 pt-1"><SignOutButton /></div>
    </div>}
  </div>;
}
