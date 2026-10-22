"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function useWorkLogRealtimeRefresh() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const isRefreshingRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    if (isRefreshingRef.current) {
      queuedRefreshRef.current = true;
      return;
    }
    isRefreshingRef.current = true;
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshRef.current();
    }, 250);
  }, []);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
    if (!isRefreshing && queuedRefreshRef.current) {
      queuedRefreshRef.current = false;
      refreshRef.current();
    }
  }, [isRefreshing]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`work-log-refresh-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_logs" }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "master_shifts" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotels" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "services_config" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "operations_override_audit" }, scheduleRefresh)
      .subscribe();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      void supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);
}
