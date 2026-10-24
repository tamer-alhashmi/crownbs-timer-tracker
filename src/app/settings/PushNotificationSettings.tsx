"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, LoaderCircle, Smartphone } from "lucide-react";
import { showActionToast } from "@/components/ui/ActionToast";
import { usePushPermission } from "@/lib/pushPermission";
import { formatUserMessage } from "@/lib/userMessages";

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
  const result: unknown = await response.json();
  if (typeof result === "object" && result !== null && "error" in result && typeof result.error === "string") {
    return result.error;
  }
  return "Unable to update push notification settings.";
}

function waitForWorkerActivation(worker: ServiceWorker) {
  if (worker.state === "activated") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const handleStateChange = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", handleStateChange);
        resolve();
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", handleStateChange);
        reject(new Error("The push service worker could not be activated."));
      }
    };
    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  });
}

export function PushNotificationSettings({ publicKey }: Props) {
  const permission = usePushPermission();
  const [subscribed, setSubscribed] = useState(false);
  const [manuallyDisabled, setManuallyDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const enabled = permission === "granted" && !manuallyDisabled;

  const syncSubscription = useCallback(async () => {
    if (!publicKey) throw new Error("Push notifications are not configured for this application.");
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("This browser does not support web push notifications.");
    }

    const registration = await navigator.serviceWorker.register("/push/push-sw.js", { scope: "/push/" });
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("The push service worker could not be activated.");
    await waitForWorkerActivation(worker);
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodePublicKey(publicKey),
      });
    }
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) throw new Error(await responseError(response));
    setSubscribed(true);
    setManuallyDisabled(false);
  }, [publicKey]);

  useEffect(() => {
    if (permission !== "granted" || manuallyDisabled) return;
    void Promise.resolve()
      .then(() => {
        setBusy(true);
        return syncSubscription();
      })
      .catch((error: unknown) => {
        const message = formatUserMessage(error, "Unable to enable push notifications.");
        setNotice(message);
        showActionToast("error", message);
      })
      .finally(() => setBusy(false));
  }, [manuallyDisabled, permission, syncSubscription]);

  const togglePush = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (enabled) {
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
        setManuallyDisabled(true);
        showActionToast("success", "Push alerts are disabled on this device.");
        return;
      }

      if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
      const granted = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (granted !== "granted") {
        setManuallyDisabled(false);
        if (granted === "denied") setNotice("");
        window.dispatchEvent(new Event("focus"));
        return;
      }
      await syncSubscription();
      window.dispatchEvent(new Event("focus"));
      showActionToast("success", "Push alerts are enabled on this device.");
    } catch (error) {
      const message = formatUserMessage(error, "Unable to update push notification settings.");
      setNotice(message);
      showActionToast("error", message);
    } finally {
      setBusy(false);
    }
  };

  const checkPermissionAgain = () => {
    if ("Notification" in window) {
      window.dispatchEvent(new Event("focus"));
      if (Notification.permission === "granted") {
        setNotice("");
      }
    }
  };

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Smartphone className="h-5 w-5" /></span>
          <div>
            <h3 className="font-bold text-slate-950">Instant task alerts</h3>
            <p className="mt-1 text-sm leading-5 text-slate-600">Receive task assignments on this device, including lock-screen alerts where supported.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled && permission === "granted"}
          aria-label="Instant task alerts"
          disabled={busy || permission === "denied" || permission === "unsupported" || (!publicKey && !enabled)}
          onClick={() => void togglePush()}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${enabled && permission === "granted" ? "bg-sky-700" : "bg-slate-300"}`}
        >
          {busy ? <LoaderCircle className="absolute left-1/2 h-4 w-4 -translate-x-1/2 animate-spin text-white" /> : <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled && permission === "granted" ? "translate-x-6" : "translate-x-1"}`} />}
        </button>
      </div>
      {permission === "denied" && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm leading-6 text-amber-950">Notifications are currently blocked in your browser settings. To receive instant task alerts on this device, click the lock icon in your browser address bar and set Notifications to Allow.</p>
          <button type="button" onClick={checkPermissionAgain} className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-amber-900 underline underline-offset-2">
            <BellRing className="h-3.5 w-3.5" /> Check Permission Again
          </button>
        </div>
      )}
      {permission === "unsupported" && <p className="mt-3 text-xs text-slate-500">This browser does not support web push notifications.</p>}
      {!publicKey && <p className="mt-3 text-xs text-slate-500">Push service configuration is required before this device can subscribe.</p>}
      {notice && <p role="status" className="mt-3 text-sm text-rose-700">{notice}</p>}
      {permission === "granted" && !subscribed && !notice && <p className="mt-3 text-xs text-slate-500">Registering this device for task alerts…</p>}
    </section>
  );
}
