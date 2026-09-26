import { getManagementOverview } from "./actions";
import ManagementDashboardClient from "./ManagementDashboardClient";

export default async function AdminDashboardPage() {
  const data = await getManagementOverview();
  return <ManagementDashboardClient data={data} />;
}
