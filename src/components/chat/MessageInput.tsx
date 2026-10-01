"use client";

import { useMutation } from "@tanstack/react-query";
import { Camera, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { AttachmentType } from "@/lib/chat/types";
import { sendMessage, uploadAttachment } from "./chatApi";

const MAX_FILE_SIZE = 12 * 1024 * 1024;

function attachmentType(file: File): AttachmentType | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "doc";
  return null;
}

export function MessageInput({
  receiverId,
  onSent,
}: {
  receiverId: string;
  onSent: () => void;
}) {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (file && !attachmentType(file)) throw new Error("Choose an image, PDF, or Word document.");
      let attachment: { path: string; type: AttachmentType } | undefined;
      if (file) attachment = await uploadAttachment(file, receiverId);
      await sendMessage({
        receiverId,
        content: content.trim(),
        attachmentUrl: attachment?.path,
        attachmentType: attachment?.type,
      });
    },
    onSuccess: () => {
      setContent("");
      setFile(null);
      setError(null);
      onSent();
    },
    onError: (sendError) => setError(sendError.message),
  });

  function chooseFile(selected: File | undefined) {
    if (!selected) return;
    if (!attachmentType(selected)) {
      setError("Choose an image, PDF, or Word document.");
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setError("Attachments must be 12 MB or smaller.");
      return;
    }
    setError(null);
    setFile(selected);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!content.trim() && !file) || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-[#d9d4cc] bg-[#f0f2f5] p-2.5 dark:border-slate-700 dark:bg-[#202c33] sm:p-3">
      {file && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs text-slate-700 dark:bg-[#2a3942] dark:text-slate-100">
          <span className="truncate">{file.name}</span>
          <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx"
          className="hidden"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button
          type="button"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
          className="mb-1 rounded-full p-2 text-slate-600 transition hover:bg-slate-200 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Take a photo"
          onClick={() => cameraInputRef.current?.click()}
          className="mb-1 rounded-full p-2 text-slate-600 transition hover:bg-slate-200 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Camera className="h-5 w-5" />
        </button>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={5000}
          placeholder="Write a message…"
          className="max-h-24 min-h-10 flex-1 resize-none rounded-full bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-emerald-300 dark:bg-[#2a3942] dark:text-slate-100 dark:placeholder:text-slate-300 dark:focus:ring-emerald-800"
        />
        <button
          type="submit"
          disabled={mutation.isPending || (!content.trim() && !file)}
          aria-label="Send message"
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[#063b2a] transition hover:bg-[#20c45e] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </form>
  );
}
