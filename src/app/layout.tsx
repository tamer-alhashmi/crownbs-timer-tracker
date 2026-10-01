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
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  let chatProfile = user ? { name: user.email, avatarUrl: null as string | null } : null;
  if (user) {
    const supabase = createPrivilegedServerSupabaseClient();
    const { data: profile, error } = await supabase.from("users").select("full_name, avatar_url").eq("id", user.userId).maybeSingle();
    if (error) {
      console.error("Global chat profile lookup failed:", error.message);
    } else if (profile) {
      chatProfile = { name: profile.full_name || user.email, avatarUrl: profile.avatar_url };
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-slate-100 text-slate-900">
        <ChatProviders>
          {children}
          {user && chatProfile && <GlobalChatWidget user={user} profile={chatProfile} />}
          <BackButtonHandler />
        </ChatProviders>
      </body>
    </html>
  );
}
