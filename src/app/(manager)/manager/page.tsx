import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getManagementOverview } from "../../(admin)/admin/actions";
import ManagementDashboardClient from "../../(admin)/admin/ManagementDashboardClient";
import { getTaskDispatchData } from "@/app/settings/taskActions";
import { RoleIntelligenceSection } from "@/components/dashboard/RoleIntelligenceSection";

export default async function ManagerDashboardPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "manager") redirect("/login");
  const [data, dispatchData] = await Promise.all([getManagementOverview(), getTaskDispatchData()]);
  return <ManagementDashboardClient data={data} dispatchData={dispatchData} tenantIntelligence={<RoleIntelligenceSection />} />;
}
