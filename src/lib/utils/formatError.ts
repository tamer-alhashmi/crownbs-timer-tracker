const CONNECTION_ERROR = /\b(failed to fetch|networkerror|network request failed|connection (?:lost|interrupted)|fetch failed)\b/i;
const UNIQUE_CONFLICT = /\b(p2002|23505|duplicate key|unique constraint)\b/i;
const PERMISSION_ERROR = /\b(unauthorized|forbidden|permission denied)\b/i;
const TECHNICAL_DETAILS =
  /\b(minified react error|react\.dev\/errors|syntaxerror|typeerror|referenceerror|pgrst\d*|postgrest|supabase|stack trace|uncaught|internal server error|database error|sql error|constraint violation|relation .+ does not exist|column .+ does not exist|\b(?:400|401|403|404|409|429|500|502|503)\b)\b|(?:\{\s*["']?(?:code|details|hint)["']?\s*:|<\s*(?:!doctype|html|script)\b)/i;
const INTERNAL_DETAILS = /(?:\bat\s+[\w$.<]+\s*\(|(?:src|app|lib|node_modules)[\\/][\w./\\-]+|\bError:\s|https?:\/\/(?:react\.dev|nextjs\.org)\/errors\/)/i;

export function humanizeErrorMessage(
  error: unknown,
  fallback = "Unable to complete this request right now. Please try again.",
): string {
  const rawMessage = getErrorMessage(error);
  const message = rawMessage.trim();

  if (!message) {
    console.error("[Crown Ops Technical Error]:", error);
    return fallback;
  }
  if (/minified react error|react\.dev\/errors/i.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "Your update may take a moment to appear. Refresh the page to check the latest status.";
  }
  if (/manifest|syntax error|syntaxerror/i.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "App resources could not be loaded. Please refresh the page and try again.";
  }
  if (CONNECTION_ERROR.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "Connection interrupted. Please check your internet connection and try again.";
  }
  if (UNIQUE_CONFLICT.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "A record with this information already exists.";
  }
  if (PERMISSION_ERROR.test(message)) {
    console.error("[Crown Ops Technical Error]:", error);
    return "You do not have permission to perform this action.";
  }
  if (TECHNICAL_DETAILS.test(message) || INTERNAL_DETAILS.test(message) || message.length > 120) {
    console.error("[Crown Ops Technical Error]:", error);
    return fallback;
  }

  return message;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error !== "object" || error === null) return "";
  if ("message" in error && typeof error.message === "string") return error.message;
  if ("error" in error && typeof error.error === "string") return error.error;
  return "";
}
