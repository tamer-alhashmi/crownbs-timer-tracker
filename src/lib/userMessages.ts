const TECHNICAL_DETAILS =
  /\b(failed to fetch|typeerror|referenceerror|syntaxerror|pgrst\d*|postgrest|supabase|stack trace|uncaught|networkerror|internal server error|database error|sql error|constraint violation|permission denied|relation .+ does not exist|column .+ does not exist|duplicate key|23505|400|401|403|404|409|429|500|502|503)\b|(?:\{\s*["']?(?:code|details|hint)["']?\s*:|<\s*(?:!doctype|html|script)\b)/i;

const CONNECTION_ERROR = /\b(failed to fetch|networkerror|network request failed|connection (?:lost|interrupted))\b/i;
const UNIQUE_CONFLICT = /\b(duplicate key|23505|unique constraint)\b/i;

export function formatUserMessage(
  error: unknown,
  fallback = "Unable to complete this request right now. Please try again."
): string {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";

  if (!message.trim()) {
    console.error("[Internal Error]:", error);
    return fallback;
  }
  if (UNIQUE_CONFLICT.test(message)) return "This item is already assigned to an active manager or owner.";
  if (CONNECTION_ERROR.test(message)) {
    console.error("[Internal Error]:", error);
    return "Connection interrupted. Please verify your connection and try again.";
  }
  if (TECHNICAL_DETAILS.test(message)) {
    console.error("[Internal Error]:", error);
    return fallback;
  }
  return message;
}
