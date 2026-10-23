export const USER_ROLES = [
  "super_admin",
  "admin",
  "owner",
  "manager",
  "housekeeping_admin",
  "cleaner",
] as const;

export type CanonicalUserRole = (typeof USER_ROLES)[number];
export type UserRole = CanonicalUserRole | "hk_admin";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  owner: "Owner",
  manager: "Manager",
  housekeeping_admin: "Housekeeping Admin",
  hk_admin: "Housekeeping Admin",
  cleaner: "Cleaner",
};

export function isUserRole(value: unknown): value is UserRole {
  return value === "hk_admin" || (typeof value === "string" && USER_ROLES.includes(value as (typeof USER_ROLES)[number]));
}

export function normalizeUserRole(role: UserRole): CanonicalUserRole {
  return role === "hk_admin" ? "housekeeping_admin" : role;
}

export function isPlatformAdmin(role: UserRole | string): boolean {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdmin(role: UserRole | string): boolean {
  return role === "super_admin";
}

export function isHousekeepingAdmin(role: UserRole | string): boolean {
  return role === "housekeeping_admin" || role === "hk_admin";
}
