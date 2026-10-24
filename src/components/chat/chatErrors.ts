import { formatUserMessage } from "@/lib/userMessages";

export function safeChatError(error: unknown, fallback = "We couldn't complete that chat action. Please check your connection and try again."): string {
  const safeMessage = formatUserMessage(error, fallback);
  return safeMessage === fallback
    ? `${fallback} / تعذر تنفيذ هذا الإجراء. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.`
    : safeMessage;
}

export function logChatError(error: unknown): void {
  console.error("[Chat System Error]:", error);
}
