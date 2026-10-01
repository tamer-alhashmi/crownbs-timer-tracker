"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

export function BackButtonHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    let listener: PluginListenerHandle | undefined;
    void App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    }).then((handle) => {
      if (active) listener = handle;
      else void handle.remove();
    });

    return () => {
      active = false;
      void listener?.remove();
    };
  }, []);

  return null;
}
