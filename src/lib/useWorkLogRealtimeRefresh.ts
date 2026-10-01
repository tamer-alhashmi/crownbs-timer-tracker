"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function useWorkLogRealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("work-log-dashboard-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_logs" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "master_shifts" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "hotels" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "services_config" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "operations_override_audit" }, () => router.refresh())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);
}
