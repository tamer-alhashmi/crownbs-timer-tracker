import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function HousekeepingAdminPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "hk_admin") redirect("/login");
  redirect("/settings");
}
