import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getManagementOverview } from "../../(admin)/admin/actions";
import ManagementDashboardClient from "../../(admin)/admin/ManagementDashboardClient";

export default async function ManagerDashboardPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "manager") redirect("/login");
  const data = await getManagementOverview();
  return <ManagementDashboardClient data={data} />;
}
