"use client";

type AppBadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function getBadgeNavigator(): AppBadgeNavigator | null {
  return typeof navigator === "undefined" ? null : navigator as AppBadgeNavigator;
}

export async function updateAppBadge(count: number) {
  const badgeNavigator = getBadgeNavigator();
  if (!badgeNavigator) return;
  try {
    if (count > 0) {
      await badgeNavigator.setAppBadge?.(Math.max(1, Math.floor(count)));
    } else {
      if (badgeNavigator.clearAppBadge) await badgeNavigator.clearAppBadge();
      else await badgeNavigator.setAppBadge?.(0);
    }
  } catch (error) {
    console.error("Unable to update the application badge:", error);
  }
}

export async function clearAppBadge() {
  const badgeNavigator = getBadgeNavigator();
  if (!badgeNavigator) return;
  try {
    if (badgeNavigator.clearAppBadge) await badgeNavigator.clearAppBadge();
    else await badgeNavigator.setAppBadge?.(0);
  } catch (error) {
    console.error("Unable to clear the application badge:", error);
  }
}
