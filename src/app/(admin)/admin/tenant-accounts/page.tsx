import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TenantAccountsHub from "../TenantAccountsHub";
import { getTenantAccountsPage } from "../tenantAccountsActions";

export default async function TenantAccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/admin");
  const initialData = await getTenantAccountsPage();
  return <TenantAccountsHub initialData={initialData} />;
}
