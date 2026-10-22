"use client";

import { useRef, useState } from "react";
import { Clock3, Mic, Send, Trash2 } from "lucide-react";
import { logChatError } from "./chatErrors";

const MAX_BYTES = 2 * 1024 * 1024;

export function VoiceMessageRecorder({ onSend }: { onSend: (blob: Blob, durationSeconds: number) => Promise<void> }) {
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);
  const sendOnStopRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  const start = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Your browser doesn't support voice recording. Please use a supported browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const shouldSend = sendOnStopRef.current;
        sendOnStopRef.current = false;
        release();
        setRecording(false);
        if (!shouldSend) return;
        if (blob.size > MAX_BYTES) {
          setError("This voice note is over 2 MB. Please record a shorter note.");
          return;
        }
        setSending(true);
        void onSend(blob, Math.max(1, elapsedRef.current)).catch((sendError: unknown) => {
          logChatError(sendError);
          setError("Couldn't send your voice note. Please check your connection and try again.");
        }).finally(() => setSending(false));
      };
      recorder.start(250);
      setElapsed(0);
      elapsedRef.current = 0;
      setRecording(true);
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= 180) {
          setError("Voice notes are limited to three minutes. Please record a shorter note.");
          if (recorder.state !== "inactive") recorder.stop();
        }
      }, 1000);
    } catch (cause) {
      logChatError(cause);
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Please enable microphone access in your browser settings to record a voice note. / يرجى تفعيل صلاحية الميكروفون من إعدادات المتصفح."
        : "Couldn't access the microphone. Check your connection and try again. / تعذر الوصول إلى الميكروفون. تحقق من الاتصال وحاول مرة أخرى.");
    }
  };

  const finish = (send: boolean) => {
    sendOnStopRef.current = send;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const time = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;

  return (
    <div className="relative">
      {!recording && (
        <button type="button" aria-label="Record a voice note" disabled={sending} onClick={() => void start()} className="mb-1 rounded-full p-2 text-slate-600 transition hover:bg-slate-200 hover:text-emerald-800 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700">
          {sending ? <Clock3 className="h-5 w-5 animate-pulse" /> : <Mic className="h-5 w-5" />}
        </button>
      )}
      {recording && (
        <div className="absolute bottom-12 left-0 z-20 flex w-[min(300px,85vw)] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-rose-600"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-800">Recording voice note</span>
            <span className="flex h-4 items-center gap-1" aria-hidden="true">
              {Array.from({ length: 14 }, (_, index) => <span key={index} className="w-1 animate-pulse rounded bg-emerald-500" style={{ height: `${5 + (index * 7) % 12}px`, animationDelay: `${index * 40}ms` }} />)}
            </span>
          </span>
          <span className="text-xs tabular-nums text-slate-600">{time}</span>
          <button type="button" aria-label="Cancel recording" onClick={() => finish(false)} className="rounded-full p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          <button type="button" aria-label="Send voice note" onClick={() => finish(true)} className="rounded-full bg-emerald-600 p-2 text-white hover:bg-emerald-700"><Send className="h-4 w-4" /></button>
        </div>
      )}
      {error && <div role="alert" className="absolute bottom-12 right-0 z-20 w-64 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">{error}</div>}
    </div>
  );
}
