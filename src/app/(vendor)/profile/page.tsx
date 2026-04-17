"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const { vendor, loading, updateVendor, uploadImage } = useVendor(user?.id);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"profile" | "banner" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const profileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const currentName = displayName ?? vendor?.display_name ?? "";
  const currentBio = bio ?? vendor?.bio ?? "";
  const currentWhatsapp = whatsapp ?? vendor?.whatsapp_number ?? "";

  const hasChanges =
    (displayName !== null && displayName !== vendor?.display_name) ||
    (bio !== null && bio !== (vendor?.bio ?? "")) ||
    (whatsapp !== null && whatsapp !== vendor?.whatsapp_number);

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateVendor({
        displayName: displayName ?? undefined,
        bio: bio !== null ? (bio || null) : undefined,
        whatsappNumber: whatsapp ?? undefined,
      });
      setDisplayName(null);
      setBio(null);
      setWhatsapp(null);
      setMessage("Saved!");
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File, type: "profile" | "banner") => {
    if (file.size > 2 * 1024 * 1024) {
      setMessage("Image must be under 2 MB.");
      return;
    }
    setUploading(type);
    setMessage(null);
    try {
      const url = await uploadImage(file, type);
      await updateVendor(
        type === "profile" ? { profileImageUrl: url } : { bannerImageUrl: url }
      );
      setMessage(`${type === "profile" ? "Profile" : "Banner"} image updated!`);
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage("Upload failed.");
    } finally {
      setUploading(null);
    }
  };

  const initials = (vendor?.display_name ?? "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (loading) {
    return (
      <div className="px-4 pt-6 text-center text-text-muted text-sm">Loading...</div>
    );
  }

  if (!user || !vendor) {
    return (
      <div className="px-4 pt-6">
        <a
          href="/login"
          className="flex items-center justify-center w-full h-12 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-24">
      <header className="mb-6">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kard</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <p className="text-text-secondary text-sm mt-1">Profile & Branding</p>
      </header>

      {/* Banner */}
      <div className="relative mb-8">
        <button
          onClick={() => bannerInputRef.current?.click()}
          disabled={uploading === "banner"}
          className="w-full h-28 rounded-2xl bg-bg-surface border border-border-default overflow-hidden group relative"
        >
          {vendor.banner_image_url ? (
            <img
              src={vendor.banner_image_url}
              alt="Banner"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
              <span className="text-xs">Tap to add banner</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-2xl flex items-center justify-center">
            <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              {uploading === "banner" ? "Uploading..." : "Change banner"}
            </span>
          </div>
        </button>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file, "banner");
            e.target.value = "";
          }}
        />

        {/* Profile image overlapping banner */}
        <div className="absolute -bottom-6 left-4">
          <button
            onClick={() => profileInputRef.current?.click()}
            disabled={uploading === "profile"}
            className="w-16 h-16 rounded-full border-4 border-bg-primary overflow-hidden bg-primary-800 group relative"
          >
            {vendor.profile_image_url ? (
              <img
                src={vendor.profile_image_url}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full text-primary-200 font-bold text-lg">
                {initials}
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <svg className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
            </div>
          </button>
          <input
            ref={profileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file, "profile");
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Form fields */}
      <div className="space-y-4">
        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">Display name</label>
          <input
            type="text"
            value={currentName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-bg-surface-2 text-text-primary rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          />
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">Bio</label>
          <textarea
            value={currentBio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell buyers about your store..."
            rows={3}
            maxLength={200}
            className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none resize-none"
          />
          <p className="text-text-muted text-[10px] text-right mt-0.5">{currentBio.length}/200</p>
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">WhatsApp number</label>
          <input
            type="tel"
            value={currentWhatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="+60123456789"
            className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          />
        </div>

        <div className="bg-bg-surface rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary text-sm">Email</span>
            <span className="text-text-primary text-sm">{user.email}</span>
          </div>
        </div>

        <div className="bg-bg-surface rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary text-sm">Tier</span>
            <span className={`text-sm font-medium ${vendor.tier === "pro" ? "text-primary-400" : "text-text-primary"}`}>
              {vendor.tier === "pro" ? "Pro" : "Free"}
            </span>
          </div>
        </div>

        <Link
          href="/storefront"
          className="flex items-center justify-between bg-bg-surface rounded-xl p-4"
        >
          <span className="text-text-secondary text-sm">My Storefront</span>
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>

      {message && (
        <div className={`mt-4 rounded-xl p-3 text-sm text-center ${
          message.includes("fail") || message.includes("must")
            ? "border border-danger/40 bg-danger/10 text-danger"
            : "border border-success/40 bg-success/10 text-success"
        }`}>
          {message}
        </div>
      )}

      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving || !currentName.trim()}
          className="mt-4 w-full h-12 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      )}

      <button
        onClick={signOut}
        className="mt-4 w-full h-12 border border-danger/30 text-danger font-medium text-sm rounded-xl hover:bg-danger/10 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
