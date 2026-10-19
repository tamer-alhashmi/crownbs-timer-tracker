"use client";

import type { UserRole } from "@/lib/roles";

type Props = {
  name: string;
  avatarUrl?: string | null;
  role?: UserRole;
  className: string;
  imageClassName?: string;
};

const roleColors: Record<UserRole, string> = {
  admin: "bg-violet-100 text-violet-800",
  owner: "bg-amber-100 text-amber-900",
  manager: "bg-blue-100 text-blue-800",
  hk_admin: "bg-indigo-100 text-indigo-800",
  cleaner: "bg-emerald-100 text-emerald-800",
};

export function UserAvatar({ name, avatarUrl, role, className, imageClassName = "absolute inset-0 h-full w-full object-cover" }: Props) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}>
      <span aria-hidden="true" className={`inline-flex h-full w-full items-center justify-center ${role ? roleColors[role] : ""}`}>{initials}</span>
      {avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={avatarUrl}
          src={avatarUrl}
          alt=""
          className={imageClassName}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
}
