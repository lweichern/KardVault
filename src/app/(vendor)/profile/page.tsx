"use client";

import { useAuth } from "@/hooks/use-auth";

export default function ProfilePage() {
  const { user, loading, signOut } = useAuth();

  return (
    <div className="px-4 pt-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kad</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <p className="text-text-secondary text-sm mt-1">Profile</p>
      </header>

      <div className="flex flex-col items-center mb-6">
        <div className="flex items-center justify-center w-20 h-20 rounded-full bg-primary-800 mb-3">
          <svg
            className="w-10 h-10 text-primary-200"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
            />
          </svg>
        </div>

        {loading ? (
          <p className="text-text-muted text-sm">Loading...</p>
        ) : user ? (
          <p className="text-text-secondary text-sm">{user.email}</p>
        ) : (
          <p className="text-text-secondary text-sm">Sign in to get started</p>
        )}
      </div>

      {user ? (
        <div className="space-y-3">
          <div className="bg-bg-surface rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-sm">Email</span>
              <span className="text-text-primary text-sm">{user.email}</span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full h-12 border border-danger/30 text-danger font-medium text-sm rounded-xl hover:bg-danger/10 transition-colors"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <a
            href="/login"
            className="flex items-center justify-center w-full h-12 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl"
          >
            Sign in with Email
          </a>
          <div className="bg-bg-surface rounded-xl p-4">
            <p className="text-text-secondary text-sm text-center">
              Sign in with your email address. We&apos;ll send you a
              verification code.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
