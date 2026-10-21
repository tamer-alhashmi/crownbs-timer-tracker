"use client";

import { CircleCheck, CircleX, X } from "lucide-react";
import { useEffect, useState } from "react";

type ActionToastKind = "success" | "error";
type ActionToastDetail = { kind: ActionToastKind; message: string };
type ActionToastState = ActionToastDetail & { id: number };

const ACTION_TOAST_EVENT = "crown-action-toast";

export function showActionToast(kind: ActionToastKind, message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ActionToastDetail>(ACTION_TOAST_EVENT, { detail: { kind, message } }));
}

export function ActionToastViewport() {
  const [toast, setToast] = useState<ActionToastState | null>(null);

  useEffect(() => {
    let nextId = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const showToast = (event: Event) => {
      const detail = (event as CustomEvent<ActionToastDetail>).detail;
      if (!detail || !detail.message) return;
      if (timeout) clearTimeout(timeout);
      setToast({ ...detail, id: ++nextId });
      timeout = setTimeout(() => setToast(null), 3500);
    };
    window.addEventListener(ACTION_TOAST_EVENT, showToast);
    return () => {
      window.removeEventListener(ACTION_TOAST_EVENT, showToast);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  if (!toast) return null;
  const isSuccess = toast.kind === "success";
  const Icon = isSuccess ? CircleCheck : CircleX;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(1rem+env(safe-area-inset-top,0px))] z-[200] flex justify-center px-3 sm:px-4">
      <section
        key={toast.id}
        role={isSuccess ? "status" : "alert"}
        aria-live={isSuccess ? "polite" : "assertive"}
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/20"
      >
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isSuccess ? "text-emerald-600" : "text-rose-600"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-950">{isSuccess ? "Saved Successfully" : "Action Failed"}</p>
          <p className="mt-0.5 break-words text-sm text-slate-600">{toast.message}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setToast(null)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </section>
    </div>
  );
}
