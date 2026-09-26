"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { importHistoricalWorkLogs } from "@/lib/historicalImport";

export async function importHistoricalJson() {
  const user = await requireFeatureAccess("historical_import", "create");
  if (user.role !== "admin") throw new Error("Only an administrator can import historical work logs.");
  const result = await importHistoricalWorkLogs();
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/manager");
  return result;
}
