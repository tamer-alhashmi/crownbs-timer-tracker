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
      await badgeNavigator.setAppBadge?.(Math.floor(count));
    } else {
      await badgeNavigator.clearAppBadge?.();
    }
  } catch (error) {
    console.error("Unable to update the application badge:", error);
  }
}

export async function clearAppBadge() {
  const badgeNavigator = getBadgeNavigator();
  if (!badgeNavigator) return;
  try {
    await badgeNavigator.clearAppBadge?.();
  } catch (error) {
    console.error("Unable to clear the application badge:", error);
  }
}
