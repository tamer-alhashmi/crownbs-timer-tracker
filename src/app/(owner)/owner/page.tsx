import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getManagementOverview } from "../../(admin)/admin/actions";
import ManagementDashboardClient from "../../(admin)/admin/ManagementDashboardClient";

function getPeriod(searchParams: Record<string, string | string[] | undefined>) {
  const from = typeof searchParams.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from) ? searchParams.from : undefined;
  const to = typeof searchParams.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to) ? searchParams.to : undefined;
  if (from && to && from < to) {
    const exclusiveTo = new Date(`${to}T00:00:00.000Z`);
    exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
    return { from: `${from}T00:00:00.000Z`, to: exclusiveTo.toISOString() };
  }
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: monthStart.toISOString(), to: nextMonth.toISOString() };
}

export default async function OwnerDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "owner") redirect("/login");
  const data = await getManagementOverview(getPeriod(await searchParams));
  return <ManagementDashboardClient data={data} />;
}
