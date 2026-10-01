"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { savePersonalProfile } from "./profileActions";

type Props = {
  fullName: string;
  email: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
};

export default function PersonalProfileSettings({ fullName, email, phoneNumber, avatarUrl }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(fullName);
  const [phone, setPhone] = useState(phoneNumber ?? "");
  const [photo, setPhoto] = useState(avatarUrl);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [photoBusy, setPhotoBusy] = useState(false);

  const save = () => startSaving(async () => {
    try {
      setNotice(null);
      await savePersonalProfile({ fullName: name, phoneNumber: phone });
      setNotice({ kind: "success", text: "Your personal details were saved." });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to save your profile." });
    }
  });

  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setPhotoBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/profile/photo", { method: "POST", body: formData });
      const result = await response.json() as { avatarUrl?: string; warning?: string; error?: string };
      if (!response.ok || !result.avatarUrl) throw new Error(result.error ?? "Unable to upload your photo.");
      setPhoto(result.avatarUrl);
      setNotice({ kind: "success", text: result.warning ?? "Your profile photo was updated." });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to upload your photo." });
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removePhoto = async () => {
    setNotice(null);
    setPhotoBusy(true);
    try {
      const response = await fetch("/api/profile/photo", { method: "DELETE" });
      const result = await response.json() as { avatarUrl?: string | null; warning?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to remove your photo.");
      setPhoto(null);
      setNotice({ kind: "success", text: result.warning ?? "Your profile photo was removed." });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to remove your photo." });
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex items-center gap-4 sm:w-56 sm:shrink-0 sm:flex-col sm:items-start">
          <UserAvatar
            name={name}
            avatarUrl={photo}
            className="h-20 w-20 bg-sky-100 text-2xl font-semibold text-sky-800 ring-1 ring-slate-200"
          />
          <div>
            <p className="font-semibold text-slate-900">Profile photo</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">JPEG, PNG, or WebP up to 5 MB.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {photoBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {photo ? "Change photo" : "Add photo"}
              </button>
              {photo && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={photoBusy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void changePhoto(event.target.files?.[0])}
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-sky-700" />
            <h2 className="text-lg font-bold text-slate-950">Personal information</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Full name
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Phone number
              <input
                type="tel"
                value={phone}
                maxLength={32}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="tel"
                placeholder="+44 7700 900000"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Email address
              <input
                type="email"
                value={email}
                readOnly
                aria-describedby="profile-email-help"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
              />
              <span id="profile-email-help" className="mt-1 block text-xs font-normal text-slate-500">Email address cannot be changed here.</span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isSaving ? "Saving..." : "Save personal information"}
            </button>
            {notice && (
              <p role={notice.kind === "error" ? "alert" : "status"} className={`text-sm ${notice.kind === "error" ? "text-rose-700" : "text-emerald-700"}`}>
                {notice.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
