import { getManagementOverview } from "./actions";
import ManagementDashboardClient from "./ManagementDashboardClient";
import { getTaskDispatchData } from "@/app/settings/taskActions";
import { RoleIntelligenceSection } from "@/components/dashboard/RoleIntelligenceSection";

export default async function AdminDashboardPage() {
  const [data, dispatchData] = await Promise.all([getManagementOverview(), getTaskDispatchData()]);
  return (
    <ManagementDashboardClient
      data={data}
      dispatchData={dispatchData}
      tenantIntelligence={<RoleIntelligenceSection />}
    />
  );
}
