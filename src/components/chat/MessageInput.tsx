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
    <form onSubmit={submit} className="shrink-0 border-t border-slate-200 bg-white p-4">
      {file && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="truncate">{file.name}</span>
          <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-xs text-rose-600">{error}</p>}
      <div className="flex items-end gap-2">
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
          className="mb-1 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Take a photo"
          onClick={() => cameraInputRef.current?.click()}
          className="mb-1 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
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
          className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          disabled={mutation.isPending || (!content.trim() && !file)}
          aria-label="Send message"
          className="mb-0.5 flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send aria-hidden="true" className="h-4 w-4" />
              <span>Send</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
