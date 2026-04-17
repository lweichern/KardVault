import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kardvault.app",
  appName: "KardVault",
  webDir: "public",
  server: {
    url: "https://kard-vault.vercel.app/",
    cleartext: false,
  },
  ios: {
    scheme: "KardVault",
  },
};

export default config;
