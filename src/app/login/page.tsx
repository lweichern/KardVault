"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

type Step = "email" | "sent";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    if (sendError) {
      setError(sendError.message);
      return;
    }

    setStep("sent");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 bg-bg-primary">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2">
            <span className="text-text-primary">Kad</span>
            <span className="text-primary-400">Vault</span>
          </h1>
          <p className="text-text-secondary text-sm">
            TCG inventory for bazaar vendors
          </p>
        </div>

        {step === "email" ? (
          <form onSubmit={handleSendLink} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-text-secondary text-xs font-medium mb-1.5"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                className="w-full h-12 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                required
                autoComplete="email"
              />
              <p className="text-text-muted text-[11px] mt-1.5">
                We&apos;ll send a magic link to sign you in
              </p>
            </div>

            {error && (
              <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email.includes("@")}
              className="w-full h-12 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
          </form>
        ) : (
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary-800 mx-auto">
              <svg
                className="w-8 h-8 text-primary-200"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                />
              </svg>
            </div>

            <div>
              <h2 className="text-text-primary font-semibold text-lg mb-1">
                Check your email
              </h2>
              <p className="text-text-secondary text-sm">
                We sent a sign-in link to
              </p>
              <p className="text-text-primary text-sm font-medium mt-1">
                {email}
              </p>
            </div>

            <p className="text-text-muted text-xs">
              Click the link in the email to sign in. Check spam if you
              don&apos;t see it.
            </p>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="w-full h-10 text-text-secondary text-sm hover:text-text-primary transition-colors"
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
