"use client";

import { CircleAlert, X } from "lucide-react";
import { humanizeErrorMessage } from "@/lib/utils/formatError";

export function ActionErrorMessage({
  error,
  onDismiss,
  className = "",
}: {
  error: unknown;
  onDismiss?: () => void;
  className?: string;
}) {
  if (error === null || error === undefined || error === false || error === "") return null;
  const message = humanizeErrorMessage(error);

  return (
    <div role="alert" className={`my-2 flex items-center justify-between gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs font-medium text-rose-700 transition-all md:text-sm dark:text-rose-300 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-rose-500" />
        <span className="min-w-0 break-words">{message}</span>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded-md p-1 text-rose-500/70 hover:text-rose-600 dark:hover:text-rose-300" aria-label="Dismiss error">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
