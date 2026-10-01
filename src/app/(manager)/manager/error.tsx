"use client";

import { ManagementDashboardError } from "@/components/ManagementDashboardError";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ManagementDashboardError error={error} retry={retry} />;
}
