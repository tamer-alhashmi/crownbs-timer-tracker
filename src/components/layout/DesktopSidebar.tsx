"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hotel, Settings } from "lucide-react";
import { NotificationBell } from "@/components/chat/NotificationBell";
import { UserProfileMenu } from "./UserProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import type { WorkspaceNavTab } from "./MobileWorkspaceNav";

export function DesktopSidebar<Tab extends string>({
  role,
  activeTab,
  tabs,
  onSelect,
  user,
}: {
  role: string;
  activeTab: Tab | null;
  tabs: readonly WorkspaceNavTab<Tab>[];
  onSelect?: (tab: Tab) => void;
  user?: { name: string; email: string; avatarUrl: string | null; role: string };
}) {
  const pathname = usePathname();
  const settingsSelected = pathname === "/settings" || pathname.startsWith("/settings/");
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r border-line bg-surface pt-safe pb-safe text-ink md:flex">
      <div className="flex min-h-16 items-center gap-3 border-b border-line px-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Hotel className="h-5 w-5" /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">Crown Operations</span><span className="block truncate text-xs capitalize text-ink-secondary">{role.replaceAll("_", " ")} workspace</span></span>
      </div>
      <p className="px-4 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">Workspace</p>
      <nav aria-label={`${role.replaceAll("_", " ")} workspace sections`} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {tabs.map(({ id, label, Icon, href, tabButtonId, panelId }) => {
          const selected = activeTab === id;
          const className = `flex min-h-11 w-full items-center gap-3 rounded-lg border-r-2 px-3 text-left text-sm transition-colors ${
            selected ? "border-accent bg-accent/10 font-semibold text-accent" : "border-transparent text-ink-secondary hover:bg-surface-secondary hover:text-ink"
          }`;
          const content = <><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span></>;
          return href
            ? <Link key={id} href={href} aria-current={selected ? "page" : undefined} className={className}>{content}</Link>
            : <button key={id} id={tabButtonId} type="button" role="tab" aria-selected={selected} aria-controls={panelId} onClick={() => onSelect?.(id)} className={className}>{content}</button>;
        })}
        <Link
          href="/settings"
          aria-current={settingsSelected ? "page" : undefined}
          className={`flex min-h-11 w-full items-center gap-3 rounded-lg border-r-2 px-3 text-left text-sm transition-colors ${
            settingsSelected ? "border-accent bg-accent/10 font-semibold text-accent" : "border-transparent text-ink-secondary hover:bg-surface-secondary hover:text-ink"
          }`}
        >
          <Settings aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="truncate">Settings</span>
        </Link>
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <ThemeToggle />
          <NotificationBell />
        </div>
        {user && <div className="mt-3 border-t border-line pt-3">
          <UserProfileMenu name={user.name} email={user.email} avatarUrl={user.avatarUrl} role={user.role} settingsHref="/settings" showNotificationBell={false} showHelp={false} />
        </div>}
      </div>
    </aside>
  );
}
