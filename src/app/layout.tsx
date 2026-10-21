import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import "./management-dashboard.css";
import { getSessionUser } from "@/lib/auth";
import { ChatProviders } from "@/components/chat/ChatProviders";
import { GlobalChatWidget } from "@/components/chat/GlobalChatWidget";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { BackButtonHandler } from "@/components/native/BackButtonHandler";
import { ModalScrollLock } from "@/components/ui/ModalScrollLock";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crown Operations",
  description: 'Hotel Operations Suite',
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f172a" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  let chatProfile = user ? { name: user.email, avatarUrl: null as string | null, role: user.role } : null;
  let soundNotificationsEnabled = true;
  if (user) {
    const supabase = createPrivilegedServerSupabaseClient();
    const { data: profile, error } = await supabase.from("users").select("full_name, avatar_url, sound_notifications_enabled").eq("id", user.userId).maybeSingle();
    if (error) {
      console.error("Global chat profile lookup failed:", error.message);
    } else if (profile) {
      chatProfile = { name: profile.full_name || user.email, avatarUrl: profile.avatar_url, role: user.role };
      soundNotificationsEnabled = profile.sound_notifications_enabled;
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-slate-100 pb-[env(safe-area-inset-bottom,1rem)] text-slate-900">
        <ModalScrollLock />
        {user ? (
          <ChatProviders key={user.userId} soundEnabled={soundNotificationsEnabled}>
            {children}
            {chatProfile && <GlobalChatWidget user={user} profile={chatProfile} />}
            <BackButtonHandler userRole={user.role} />
          </ChatProviders>
        ) : (
          <>
            {children}
            <BackButtonHandler userRole={null} />
          </>
        )}
      </body>
    </html>
  );
}
