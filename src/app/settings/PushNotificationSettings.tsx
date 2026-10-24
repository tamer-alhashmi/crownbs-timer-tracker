"use client";

import { useEffect, useState } from "react";
import { BellRing, LoaderCircle, Smartphone } from "lucide-react";
import { showActionToast } from "@/components/ui/ActionToast";
import { usePushPermission } from "@/lib/pushPermission";

type Props = { publicKey: string | null };

function decodePublicKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function responseError(response: Response) {
  const result = await response.json() as { error?: string };
  return result.error ?? "Unable to update push notification settings.";
}

export function PushNotificationSettings({ publicKey }: Props) {
  const permission = usePushPermission();
  const [subscribed, setSubscribed] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (permission === "unsupported") return;
    void navigator.serviceWorker.getRegistration("/push/").then(async (registration) => {
      if (!registration) return;
      const subscription = await registration.pushManager.getSubscription();
      setSubscribed(Boolean(subscription));
    }).catch((error: unknown) => {
      console.error("Unable to inspect the current push subscription:", error);
      setNotice("Unable to check this device's push notification status.");
    });
  }, [permission]);

  const enablePush = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (!publicKey) throw new Error("Push notifications are not configured for this application.");
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support web push notifications.");
      }
      if (Notification.permission === "denied") {
        setShowRecovery(true);
        return;
      }
      const granted = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      window.dispatchEvent(new Event("focus"));
      if (granted !== "granted") {
        setShowRecovery(granted === "denied");
        throw new Error("Notification permission was not granted.");
      }

      const registration = await navigator.serviceWorker.register("/push/push-sw.js", { scope: "/push/" });
      const installingWorker = registration.installing;
      if (installingWorker && installingWorker.state !== "activated") {
        await new Promise<void>((resolve, reject) => {
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "activated") resolve();
            if (installingWorker.state === "redundant") reject(new Error("The push service worker could not be activated."));
          });
        });
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodePublicKey(publicKey),
      });
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSubscribed(true);
      setShowRecovery(false);
      showActionToast("success", "Push alerts are enabled on this device.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to enable push notifications.";
      setNotice(message);
      showActionToast("error", message);
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    setBusy(true);
    setNotice("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/push/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      showActionToast("success", "Push alerts are disabled on this device.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to disable push notifications.";
      setNotice(message);
      showActionToast("error", message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Smartphone className="h-5 w-5" /></span>
          <div>
            <h3 className="font-bold text-slate-950">Instant task alerts</h3>
            <p className="mt-1 text-sm leading-5 text-slate-600">Receive task assignments on this device, including lock-screen alerts where supported.</p>
          </div>
        </div>
        {subscribed ? (
          <button type="button" onClick={() => void disablePush()} disabled={busy} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Turn off on this device
          </button>
        ) : (
          <button type="button" onClick={() => void enablePush()} disabled={busy || !publicKey || permission === "unsupported"} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Turn on push notifications
          </button>
        )}
      </div>
      {permission === "denied" && !subscribed && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm leading-6 text-amber-950">⚠️ Push notifications are turned off on your device. Turn them on to get instant task alerts directly on your lock screen.</p>
          <button type="button" onClick={() => setShowRecovery((visible) => !visible)} className="mt-2 text-sm font-bold text-amber-900 underline underline-offset-2">How do I turn them on?</button>
          {showRecovery && <p className="mt-2 text-sm leading-6 text-amber-900">Open this site&apos;s permissions from your browser&apos;s address-bar or site-settings menu, allow notifications, then return here and choose &quot;Turn on push notifications&quot;.</p>}
        </div>
      )}
      {!publicKey && <p className="mt-3 text-xs text-slate-500">Push service configuration is required before this device can subscribe.</p>}
      {notice && <p role="status" className="mt-3 text-sm text-rose-700">{notice}</p>}
    </section>
  );
}
