import { cookies } from "next/headers";

export type AppUserSession = {
  userId: string;
  email: string;
  role: "admin" | "owner" | "manager" | "cleaner";
  hotelId?: string | null;
};

export async function setSessionCookies(user: AppUserSession) {
  const cookieStore = await cookies();

  cookieStore.set("role", user.role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  cookieStore.set("user-id", user.userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  cookieStore.set("hotel-id", user.hotelId ?? "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  cookieStore.set("user-email", user.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSessionCookies() {
  const cookieStore = await cookies();
  ["role", "user-id", "hotel-id", "user-email"].forEach((name) => {
    cookieStore.delete(name);
  });
}

export async function getSessionUser(): Promise<AppUserSession | null> {
  const cookieStore = await cookies();
  const role = cookieStore.get("role")?.value as AppUserSession["role"] | undefined;
  const userId = cookieStore.get("user-id")?.value;
  const email = cookieStore.get("user-email")?.value;

  if (!role || !userId || !email) {
    return null;
  }

  return {
    userId,
    email,
    role,
    hotelId: cookieStore.get("hotel-id")?.value || null,
  };
}
