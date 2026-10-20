"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";

type SoundSettings = {
  soundNotificationsEnabled: boolean;
  setSoundNotificationsEnabled: (enabled: boolean) => void;
};

const SoundSettingsContext = createContext<SoundSettings | null>(null);

export function useSoundSettings() {
  const context = useContext(SoundSettingsContext);
  if (!context) throw new Error("Sound settings must be used within ChatProviders.");
  return context;
}

export function ChatProviders({
  children,
  soundEnabled,
}: {
  children: ReactNode;
  soundEnabled: boolean;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  );
  const [soundNotificationsEnabled, setSoundNotificationsEnabled] = useState(soundEnabled);

  return (
    <QueryClientProvider client={queryClient}>
      <SoundSettingsContext.Provider value={{ soundNotificationsEnabled, setSoundNotificationsEnabled }}>
        {children}
      </SoundSettingsContext.Provider>
    </QueryClientProvider>
  );
}
