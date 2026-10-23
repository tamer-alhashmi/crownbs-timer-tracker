import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isHousekeepingAdmin } from "@/lib/roles";
import { getHKAdminDashboardData } from "./actions";
import HKAdminDashboardClient from "./HKAdminDashboardClient";
import { getTaskDispatchData } from "@/app/settings/taskActions";
import { RoleIntelligenceSection } from "@/components/dashboard/RoleIntelligenceSection";

export default async function HousekeepingAdminPage() {
  const user = await getSessionUser();
  if (!user || !isHousekeepingAdmin(user.role)) redirect("/login");
  const [data, dispatchData] = await Promise.all([getHKAdminDashboardData(), getTaskDispatchData()]);
  return <HKAdminDashboardClient data={data} dispatchData={dispatchData} intelligence={<RoleIntelligenceSection />} />;
}
