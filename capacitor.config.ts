import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.crownbs.timetracker",
  appName: "Crown Operations",
  webDir: "capacitor-web",
  server: {
    url: "https://crownbs.vercel.app",
    cleartext: false,
  },
};

export default config;
