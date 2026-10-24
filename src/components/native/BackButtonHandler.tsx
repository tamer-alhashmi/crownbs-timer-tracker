"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import type { UserRole } from "@/lib/roles";

const DASHBOARD_PATHS = new Set(["/admin", "/owner", "/overview", "/manager", "/hk-admin", "/dashboard"]);

const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  admin: "/admin",
  owner: "/owner",
  manager: "/manager",
  housekeeping_admin: "/hk-admin",
  hk_admin: "/hk-admin",
  super_admin: "/admin",
  cleaner: "/dashboard",
};

const formControlBaselines = new WeakMap<HTMLFormElement, WeakMap<Element, string | number | boolean>>();

function readControlValue(element: Element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === "file") return element.files?.length ?? 0;
    if (element.type === "checkbox" || element.type === "radio") return element.checked;
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.selectedOptions).map((option) => option.value).join("\0");
  }
  return null;
}

function recordFormControlBaseline(event: FocusEvent) {
  if (!(event.target instanceof Element)) return;
  const form = event.target.closest("form");
  if (!(form instanceof HTMLFormElement)) return;
  const value = readControlValue(event.target);
  if (value === null) return;
  let baseline = formControlBaselines.get(form);
  if (!baseline) {
    baseline = new WeakMap();
    formControlBaselines.set(form, baseline);
  }
  if (!baseline.has(event.target)) baseline.set(event.target, value);
}

function refreshSavedFormBaseline(event: Event) {
  if (!(event.target instanceof HTMLFormElement)) return;
  const baseline = new WeakMap<Element, string | number | boolean>();
  for (const element of Array.from(event.target.elements)) {
    const value = readControlValue(element);
    if (value !== null) baseline.set(element, value);
  }
  formControlBaselines.set(event.target, baseline);
}

function formHasUnsavedChanges(form: HTMLFormElement) {
  return Array.from(form.elements).some((element) => {
    const initialValue = formControlBaselines.get(form)?.get(element);
    return initialValue !== undefined && readControlValue(element) !== initialValue;
  });
}

function getTopOverlay() {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-back-button-overlay="true"], [role="dialog"], [role="alertdialog"], dialog[open]'
  )).filter((overlay) => overlay.getClientRects().length > 0);
  return overlays.sort((left, right) => {
    const leftZIndex = Number.parseInt(window.getComputedStyle(left).zIndex, 10) || 0;
    const rightZIndex = Number.parseInt(window.getComputedStyle(right).zIndex, 10) || 0;
    return leftZIndex - rightZIndex;
  }).at(-1);
}

function getTopBrowserOverlay() {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-back-button-overlay="true"], [role="dialog"], [role="alertdialog"], dialog[open]'
  )).filter((overlay) =>
    overlay.getClientRects().length > 0 &&
    window.getComputedStyle(overlay).visibility !== "hidden" &&
    !overlay.closest(".chat-panel")
  );
  return overlays.sort((left, right) => {
    const leftZIndex = Number.parseInt(window.getComputedStyle(left).zIndex, 10) || 0;
    const rightZIndex = Number.parseInt(window.getComputedStyle(right).zIndex, 10) || 0;
    return leftZIndex - rightZIndex;
  }).at(-1);
}

function closeOverlay(overlay: HTMLElement) {
  const closeButton = overlay.querySelector<HTMLButtonElement>(
    'button[aria-label*="close" i], button[aria-label*="cancel" i]'
  );
  const fallbackButton = Array.from(overlay.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    /^(cancel|close|back|understood|ok|done)$/i.test(button.textContent?.trim() ?? "")
  );
  (closeButton ?? fallbackButton)?.click();
  if (!closeButton && !fallbackButton) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  return true;
}

function closeTopOverlay() {
  const overlay = getTopOverlay();
  return overlay ? closeOverlay(overlay) : false;
}

export function BackButtonHandler({ userRole }: { userRole: UserRole | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const routeStack = useRef<string[]>([]);
  const lastBackAt = useRef(0);
  const hintTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showExitHint, setShowExitHint] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;

    let overlayHistoryEntryActive = false;
    const syncOverlayHistory = () => {
      const overlay = getTopBrowserOverlay();
      if (overlay && !overlayHistoryEntryActive) {
        window.history.pushState(
          { ...(window.history.state && typeof window.history.state === "object" ? window.history.state : {}), backButtonOverlay: true },
          "",
          window.location.href
        );
        overlayHistoryEntryActive = true;
      } else if (!overlay) {
        overlayHistoryEntryActive = false;
      }
    };
    const closeOverlayOnBack = () => {
      const overlay = getTopBrowserOverlay();
      if (!overlay) {
        overlayHistoryEntryActive = false;
        return;
      }
      closeOverlay(overlay);
      window.history.pushState(window.history.state, "", window.location.href);
      overlayHistoryEntryActive = true;
    };

    const observer = new MutationObserver(syncOverlayHistory);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "style", "open", "aria-hidden"],
    });
    window.addEventListener("popstate", closeOverlayOnBack, true);
    syncOverlayHistory();

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", closeOverlayOnBack, true);
    };
  }, []);

  useEffect(() => {
    if (!userRole || pathname === "/login" || pathname.startsWith("/auth")) {
      routeStack.current = [];
      return;
    }
    const stack = routeStack.current;
    if (stack.at(-1) !== pathname) stack.push(pathname);
  }, [pathname, userRole]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    let listener: PluginListenerHandle | undefined;
    document.addEventListener("focusin", recordFormControlBaseline, true);
    document.addEventListener("app:form-saved", refreshSavedFormBaseline);
    void App.addListener("backButton", ({ canGoBack }) => {
      const visibleOverlay = getTopOverlay();
      const forms = visibleOverlay
        ? Array.from(visibleOverlay.querySelectorAll("form"))
        : Array.from(document.forms);
      const dirty = forms.some(formHasUnsavedChanges);

      if (dirty && !window.confirm("You have unsaved changes. Do you want to discard them or stay?")) return;
      if (visibleOverlay && closeTopOverlay()) return;
      if (!userRole) {
        if (pathname !== "/login" && canGoBack) window.history.back();
        else void App.exitApp();
        return;
      }

      if (DASHBOARD_PATHS.has(pathname)) {
        const now = Date.now();
        if (now - lastBackAt.current < 1800) {
          if (hintTimeout.current) clearTimeout(hintTimeout.current);
          setShowExitHint(false);
          void App.exitApp();
          return;
        }
        lastBackAt.current = now;
        setShowExitHint(true);
        if (hintTimeout.current) clearTimeout(hintTimeout.current);
        hintTimeout.current = setTimeout(() => setShowExitHint(false), 1800);
        return;
      }

      const stack = routeStack.current;
      if (stack.at(-1) === pathname) stack.pop();
      const previousPath = stack.pop();
      const safePreviousPath = previousPath && previousPath !== "/login" && !previousPath.startsWith("/auth")
        ? previousPath
        : null;
      router.replace(safePreviousPath ?? DASHBOARD_BY_ROLE[userRole]);
    }).then((handle) => {
      if (active) listener = handle;
      else void handle.remove();
    });

    return () => {
      active = false;
      document.removeEventListener("focusin", recordFormControlBaseline, true);
      document.removeEventListener("app:form-saved", refreshSavedFormBaseline);
      if (hintTimeout.current) clearTimeout(hintTimeout.current);
      void listener?.remove();
    };
  }, [pathname, router, userRole]);

  return showExitHint ? (
    <div role="status" className="fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-lg">
      Press back again to exit
    </div>
  ) : null;
}
