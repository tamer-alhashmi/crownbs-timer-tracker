export const USER_ROLES = ["admin", "owner", "manager", "hk_admin", "cleaner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  owner: "Owner",
  manager: "Manager",
  hk_admin: "Housekeeping Admin",
  cleaner: "Cleaner",
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}
