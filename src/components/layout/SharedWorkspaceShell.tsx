"use client";

import type { UserRole } from "@/lib/roles";
import { MobileWorkspaceNav, type WorkspaceNavTab } from "./MobileWorkspaceNav";
import { DesktopSidebar } from "./DesktopSidebar";

export function SharedWorkspaceShell<Tab extends string>({
  role,
  activeTab,
  tabs,
  onSelect,
  user,
}: {
  role: UserRole | string;
  activeTab: Tab | null;
  tabs: readonly WorkspaceNavTab<Tab>[];
  onSelect?: (tab: Tab) => void;
  user?: { name: string; email: string; avatarUrl: string | null; role: string };
}) {
  return (
    <>
      <DesktopSidebar role={role} activeTab={activeTab} tabs={tabs} onSelect={onSelect} user={user} />
      <MobileWorkspaceNav activeTab={activeTab} onSelect={onSelect} tabs={tabs} />
    </>
  );
}
