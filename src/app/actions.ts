"use server";

import { redirect } from "next/navigation";
import { clearSessionCookies } from "@/lib/auth";

export async function signOut() {
  await clearSessionCookies();
  redirect("/login");
}

export async function clearSecuritySessionCookies() {
  await clearSessionCookies();
}
