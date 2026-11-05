import { humanizeErrorMessage } from "@/lib/utils/formatError";

export function formatUserMessage(
  error: unknown,
  fallback = "Unable to complete this request right now. Please try again."
): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (/already assigned to an active manager or owner/i.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "This item is already assigned to an active manager or owner.";
  }
  return humanizeErrorMessage(error, fallback);
}
