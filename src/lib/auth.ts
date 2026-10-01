import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type AppUserSession = {
  userId: string;
  email: string;
  role: "admin" | "owner" | "manager" | "cleaner";
  hotelId?: string | null;
};

function chatSessionProof(user: AppUserSession): string | null {
  const secret = process.env.CHAT_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const payload = JSON.stringify({
    userId: user.userId,
    email: user.email,
    role: user.role,
    hotelId: user.hotelId ?? null,
  });
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function setSessionCookies(user: AppUserSession) {
  const cookieStore = await cookies();
  const proof = chatSessionProof(user);

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
  if (proof) {
    cookieStore.set("chat-session-proof", proof, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } else {
    cookieStore.delete("chat-session-proof");
  }
}

export async function clearSessionCookies() {
  const cookieStore = await cookies();
  ["role", "user-id", "hotel-id", "user-email", "chat-session-proof"].forEach((name) => {
    cookieStore.delete(name);
  });
}

export async function getVerifiedChatSessionUser(): Promise<AppUserSession | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const expected = chatSessionProof(user);
  const cookieStore = await cookies();
  const received = cookieStore.get("chat-session-proof")?.value;
  if (!expected || !received) return null;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }
  return user;
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
