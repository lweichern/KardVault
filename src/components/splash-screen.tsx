"use client";

import { useEffect, useState } from "react";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFadeOut(true), 1200);
    const done = setTimeout(onComplete, 1800);
    return () => { clearTimeout(timer); clearTimeout(done); };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg-primary transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Logo */}
      <div className="mb-4 animate-[splash-scale_0.6s_ease-out]">
        <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-primary-800 border border-primary-600">
          <svg className="w-10 h-10 text-primary-400" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V15m0 0l-2.25 1.313M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M21 7.5v9.75A2.25 2.25 0 0118.75 19.5H5.25A2.25 2.25 0 013 17.25V7.5" />
          </svg>
        </div>
      </div>

      {/* Brand name */}
      <h1 className="text-2xl font-bold animate-[splash-fade_0.6s_ease-out_0.2s_both]">
        <span className="text-text-primary">Kard</span>
        <span className="text-primary-400">Vault</span>
      </h1>

      {/* Tagline */}
      <p className="text-text-muted text-xs mt-2 animate-[splash-fade_0.6s_ease-out_0.4s_both]">
        Your TCG inventory, digitized
      </p>
    </div>
  );
}
