const TECHNICAL_ERROR =
  /\b(failed to fetch|typeerror|referenceerror|syntaxerror|pgrst\d*|postgrest|supabase|stack trace|uncaught|networkerror|cannot read properties|is not a function|undefined|null pointer|internal server error|database error|sql error|constraint violation|permission denied|relation .+ does not exist|column .+ does not exist)\b/i;

export function safeChatError(error: unknown, fallback = "We couldn't complete that chat action. Please check your connection and try again."): string {
  if (error instanceof Error) {
    if (!TECHNICAL_ERROR.test(error.message)) return error.message;
    console.error("[Chat System Error]:", error);
    return `${fallback} / تعذر تنفيذ هذا الإجراء. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.`;
  }
  console.error("[Chat System Error]:", error);
  return `${fallback} / تعذر تنفيذ هذا الإجراء. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.`;
}

export function logChatError(error: unknown): void {
  console.error("[Chat System Error]:", error);
}
