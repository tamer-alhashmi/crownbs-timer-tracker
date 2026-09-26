"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { syncRoomsFromGoogleSheet } from "@/lib/roomImport";

export async function importRoomsFromGoogleSheet() {
  const user = await requireFeatureAccess("rooms", "create");
  if (user.role !== "admin") throw new Error("Only an administrator can import rooms from Google Sheets.");

  const result = await syncRoomsFromGoogleSheet();
  revalidatePath("/admin");
  return result;
}
