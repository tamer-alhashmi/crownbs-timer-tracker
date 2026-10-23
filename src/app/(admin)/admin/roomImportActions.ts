"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { isPlatformAdmin } from "@/lib/roles";
import { syncRoomsFromGoogleSheet } from "@/lib/roomImport";

export async function importRoomsFromGoogleSheet() {
  const user = await requireFeatureAccess("rooms", "create");
  if (!isPlatformAdmin(user.role)) throw new Error("Only an administrator can import rooms from Google Sheets.");

  const result = await syncRoomsFromGoogleSheet();
  revalidatePath("/admin");
  return result;
}
