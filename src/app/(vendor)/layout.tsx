"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SplashScreen } from "@/components/splash-screen";
import { VendorOnboarding } from "@/components/vendor-onboarding";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";

export default function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { vendor, loading: vendorLoading, createVendor } = useVendor(user?.id);
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === "undefined") return false;
    const key = "kardvault_splash_shown";
    const shown = sessionStorage.getItem(key);
    if (shown) return false;
    sessionStorage.setItem(key, "1");
    return true;
  });

  const handleSplashComplete = useCallback(() => setShowSplash(false), []);

  const loading = authLoading || vendorLoading;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <>
        <main className="flex-1 pb-20 flex items-center justify-center">
          <p className="text-text-muted text-sm">Loading...</p>
        </main>
        <BottomNav />
      </>
    );
  }

  // User is logged in but has no vendor profile — show onboarding
  if (!vendor) {
    return (
      <>
        <main className="flex-1 pb-20">
          <VendorOnboarding onCreate={createVendor} />
        </main>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      <main className="flex-1 pb-20">{children}</main>
      <BottomNav />
    </>
  );
}
