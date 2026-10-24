"use client";

import { useSyncExternalStore } from "react";

function currentPushPermission(): NotificationPermission | "unsupported" {
  if (
    typeof window === "undefined"
    || !("Notification" in window)
    || !("serviceWorker" in navigator)
    || !("PushManager" in window)
  ) {
    return "unsupported";
  }
  return Notification.permission;
}

function subscribeToPushPermission(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

export function usePushPermission() {
  return useSyncExternalStore(subscribeToPushPermission, currentPushPermission, () => "default");
}
