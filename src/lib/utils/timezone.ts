export const UK_TIMEZONE = "Europe/London";
export const EGYPT_TIMEZONE = "Africa/Cairo";

export function toUtcIso(date: Date | string) {
  return new Date(date).toISOString();
}

export function formatInTimeZone(
  date: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(new Date(date));
}

export function formatCleanerTime(date: Date | string) {
  return formatInTimeZone(date, UK_TIMEZONE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatAdminTime(date: Date | string) {
  return formatInTimeZone(date, EGYPT_TIMEZONE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function getUkTimeNow() {
  return formatInTimeZone(new Date(), UK_TIMEZONE);
}

export function getCairoTimeNow() {
  return formatInTimeZone(new Date(), EGYPT_TIMEZONE);
}

export function getCurrentUtcTimestamp() {
  return new Date().toISOString();
}
