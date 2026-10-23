"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { isPlatformAdmin } from "@/lib/roles";
import { importHistoricalWorkLogs } from "@/lib/historicalImport";

export async function importHistoricalJson() {
  const user = await requireFeatureAccess("historical_import", "create");
  if (!isPlatformAdmin(user.role)) throw new Error("Only an administrator can import historical work logs.");
  const result = await importHistoricalWorkLogs();
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/manager");
  return result;
}
