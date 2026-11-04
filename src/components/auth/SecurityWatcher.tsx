"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clearSecuritySessionCookies } from "@/app/actions";
import { isUserRole, normalizeUserRole, type UserRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { SecurityLockOverlay } from "@/components/ui/SecurityLockOverlay";

type LockReason = "role-changed" | "account-suspended";
type LockState = { reason: LockReason; countdown: number };

export function SecurityWatcher({ userId, role, children }: {
  userId: string;
  role: UserRole;
  children: ReactNode;
}) {
  const [lockState, setLockState] = useState<LockState | null>(null);
  const lockedRef = useRef(false);
  const logoutStartedRef = useRef(false);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;
    const lockForReason = (reason: LockReason) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      document.body.style.overflow = "hidden";
      setLockState({ reason, countdown: 5 });
    };
    const channel = supabase
      .channel(`security-watcher-${userId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "users",
        filter: `id=eq.${userId}`,
      }, (payload) => {
        const newProfile = payload.new as { role?: unknown; is_active?: unknown };
        const oldProfile = payload.old as { role?: unknown };
        const oldRole = isUserRole(oldProfile.role) ? oldProfile.role : role;
        const roleChanged = isUserRole(newProfile.role)
          && normalizeUserRole(newProfile.role) !== normalizeUserRole(oldRole);
        const suspended = newProfile.is_active === false;

        if (suspended) lockForReason("account-suspended");
        else if (roleChanged) lockForReason("role-changed");
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Security watcher subscription failed:", error ?? status);
        }
        if (status === "SUBSCRIBED") {
          void (async () => {
            try {
              const { data, error: profileError } = await supabase
                .from("users")
                .select("role, is_active")
                .eq("id", userId)
                .maybeSingle();
              if (profileError) {
                console.error("Security watcher profile verification failed:", profileError);
              } else if (!data || data.is_active === false) {
                lockForReason("account-suspended");
              } else if (isUserRole(data.role) && normalizeUserRole(data.role) !== normalizeUserRole(role)) {
                lockForReason("role-changed");
              }
            } catch (profileError) {
              console.error("Security watcher profile verification failed:", profileError);
            }
          })();
        }
      });

    return () => {
      supabaseRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [role, userId]);

  useEffect(() => {
    if (!lockState || lockState.countdown === 0) return;
    const timer = window.setTimeout(() => {
      setLockState((current) => current
        ? { ...current, countdown: Math.max(0, current.countdown - 1) }
        : null);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [lockState]);

  useEffect(() => {
    if (!lockState || lockState.countdown !== 0 || logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    const redirectPath = lockState.reason === "account-suspended"
      ? "/login?reason=account-suspended"
      : "/login?reason=role-changed";

    const forceSignOut = async () => {
      try {
        const supabase = supabaseRef.current;
        if (!supabase) throw new Error("Supabase client is unavailable.");
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch (error) {
        console.error("Supabase sign-out after a security change failed:", error);
      }

      try {
        await clearSecuritySessionCookies();
      } catch (error) {
        console.error("App session cleanup after a security change failed:", error);
      }

      window.location.replace(redirectPath);
    };

    void forceSignOut();
  }, [lockState]);

  return (
    <>
      <div className="contents" inert={lockState !== null} aria-hidden={lockState !== null}>
        {children}
      </div>
      {lockState && <SecurityLockOverlay reason={lockState.reason} countdown={lockState.countdown} />}
    </>
  );
}
