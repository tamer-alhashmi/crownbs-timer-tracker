"use client";

import { useState } from "react";
import { ChevronDown, Settings, UserRound } from "lucide-react";
import { SignOutButton } from "./SignOutButton";

type Props = { name: string; email: string; role: string; settingsHref: string };

export function UserProfileMenu({ name, email, role, settingsHref }: Props) {
  const [open, setOpen] = useState(false);

  return <div className="relative z-50 overflow-visible">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
      <span className="rounded-lg bg-sky-100 p-1.5 text-sky-700"><UserRound className="h-4 w-4" /></span>
      <span className="hidden max-w-32 truncate sm:block">{name}</span>
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div role="menu" className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl">
      <div className="border-b border-slate-100 px-3 py-2"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-slate-500">{email}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">{role}</p></div>
      <a href={settingsHref} role="menuitem" className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings className="h-4 w-4" /> Settings and preferences</a>
      <div className="mt-1 border-t border-slate-100 pt-1"><SignOutButton /></div>
    </div>}
  </div>;
}
