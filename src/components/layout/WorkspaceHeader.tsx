"use client";

import type { ReactNode } from "react";
import { Hotel } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { UserProfileMenu } from "./UserProfileMenu";

type Props = {
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  actions?: ReactNode;
  offsetSidebar?: boolean;
};

export function WorkspaceHeader({ name, email, role, avatarUrl, actions, offsetSidebar = true }: Props) {
  return (
    <header className={`sticky top-0 z-30 border-b border-line bg-surface/95 pt-safe text-ink backdrop-blur ${offsetSidebar ? "md:ml-64" : ""}`}>
      <div className="flex h-16 min-w-0 items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent sm:h-9 sm:w-9">
            <Hotel aria-hidden="true" className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
          <h1 className="whitespace-nowrap text-xs font-bold text-ink sm:text-base">Crown Operations</h1>
          <span className="hidden max-w-64 truncate rounded-full border border-line bg-surface-secondary px-2.5 py-1 text-xs font-medium text-ink-secondary sm:inline-flex">
            {name} · <span className="ml-1 capitalize">{role.replaceAll("_", " ")}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {actions}
          <ThemeToggle />
          <UserProfileMenu name={name} email={email} avatarUrl={avatarUrl} role={role} settingsHref="/settings" />
        </div>
      </div>
    </header>
  );
}
