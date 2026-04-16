import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kadvault.app",
  appName: "KadVault",
  webDir: "public",
  server: {
    url: "https://kadvault.vercel.app",
    cleartext: false,
  },
  ios: {
    scheme: "KadVault",
  },
};

export default config;
