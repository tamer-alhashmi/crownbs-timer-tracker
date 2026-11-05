"use client";

import Link from "next/link";
import type { UserRole } from "@/lib/roles";
import { MobileWorkspaceNav, type WorkspaceNavTab } from "./MobileWorkspaceNav";

export function SharedWorkspaceShell<Tab extends string>({
  role,
  activeTab,
  tabs,
  onSelect,
}: {
  role: UserRole | string;
  activeTab: Tab | null;
  tabs: readonly WorkspaceNavTab<Tab>[];
  onSelect?: (tab: Tab) => void;
}) {
  const label = `${role.replaceAll("_", " ")} workspace sections`;

  return (
    <>
      <nav aria-label={label} role="tablist" className="hidden min-w-0 max-w-full gap-1 overflow-x-auto border-b border-line bg-surface px-3 [-webkit-overflow-scrolling:touch] md:flex sm:px-6 lg:px-8">
        {tabs.map(({ id, label: tabLabel, Icon, href, tabButtonId, panelId }) => {
          const className = `inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors sm:text-sm ${
            activeTab === id
              ? "border-accent font-semibold text-accent"
              : "border-transparent font-medium text-ink-secondary hover:text-ink"
          }`;
          return href
            ? <Link key={id} href={href} aria-current={activeTab === id ? "page" : undefined} className={className}><Icon aria-hidden="true" className="h-4 w-4" />{tabLabel}</Link>
            : <button key={id} id={tabButtonId} type="button" role="tab" aria-selected={activeTab === id} aria-controls={panelId} onClick={() => onSelect?.(id)} className={className}><Icon aria-hidden="true" className="h-4 w-4" />{tabLabel}</button>;
        })}
      </nav>
      <MobileWorkspaceNav activeTab={activeTab} onSelect={onSelect} tabs={tabs} />
    </>
  );
}
