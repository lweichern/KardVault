/**
 * Build stamp (version + deploy commit), baked in at build time via
 * next.config.ts. Shown on login and profile so testers can immediately tell
 * whether the service worker is still serving a stale bundle.
 */
export function AppVersion({ className = "" }: { className?: string }) {
  return (
    <p className={`text-text-muted text-[10px] text-center ${className}`}>
      v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_BUILD_ID}
    </p>
  );
}
