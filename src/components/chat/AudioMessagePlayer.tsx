"use client";

import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { logChatError } from "./chatErrors";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function AudioMessagePlayer({ src, isOwn = false }: { src: string; isOwn?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const speedOptions = [1, 1.5, 2];
  const toggleSpeed = () => {
    const next = speedOptions[(speedOptions.indexOf(speed) + 1) % speedOptions.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className={`relative flex w-full min-w-0 max-w-[17rem] items-center gap-2 ${isOwn ? "text-white" : "text-slate-800 dark:text-slate-100"}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const actualDuration = event.currentTarget.duration;
          if (Number.isFinite(actualDuration) && actualDuration >= 0) setDuration(actualDuration);
        }}
        onDurationChange={(event) => {
          const actualDuration = event.currentTarget.duration;
          if (Number.isFinite(actualDuration) && actualDuration >= 0) setDuration(actualDuration);
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          setCurrentTime(Number.isFinite(duration) && duration > 0 ? Math.min(time, duration) : time);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(Number.isFinite(duration) ? duration : 0);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          logChatError(new Error("Voice message playback failed"));
          setError("Couldn't play this voice note. Please check your connection and try again.");
        }}
      />
      <button type="button" aria-label={playing ? "Pause voice note" : "Play voice note"} onClick={() => {
        if (audioRef.current?.paused) {
          void audioRef.current.play().then(() => setError("")).catch((cause: unknown) => {
            logChatError(cause);
            setError("Couldn't play this voice note. Please check your connection and try again.");
          });
        }
        else audioRef.current?.pause();
      }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isOwn ? "bg-white/20" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"}`}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <input type="range" min={0} max={duration || 1} step={0.05} value={Math.min(currentTime, duration || 1)} aria-label="Seek voice note" disabled={!duration} onChange={(event) => {
          const time = Math.max(0, Math.min(Number(event.target.value), duration));
          if (audioRef.current) audioRef.current.currentTime = time;
          setCurrentTime(time);
        }} className="block h-1.5 w-full cursor-pointer accent-emerald-500 disabled:cursor-default" />
        <div className={`flex justify-between text-[10px] ${isOwn ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>
          <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
        </div>
      </div>
      <button type="button" aria-label={`Playback speed ${speed} times`} onClick={toggleSpeed} className={`rounded-full px-1.5 py-1 text-[10px] font-bold ${isOwn ? "bg-white/15" : "bg-slate-100 dark:bg-[#111b21]"}`}>{speed}x</button>
      {error && <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-60 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 shadow">{error}</span>}
    </div>
  );
}
