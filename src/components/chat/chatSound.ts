"use client";

export type ChatSound = "sent" | "received" | "alert";

export function playChatSound(sound: ChatSound) {
  if (typeof window === "undefined" || !("AudioContext" in window)) return;

  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const duration = sound === "alert" ? 0.32 : 0.2;
  const frequency = sound === "sent" ? 620 : sound === "received" ? 880 : 1040;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  if (sound === "received") oscillator.frequency.exponentialRampToValueAtTime(1175, now + duration);
  if (sound === "sent") oscillator.frequency.exponentialRampToValueAtTime(820, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(sound === "alert" ? 0.09 : 0.055, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.onended = () => {
    void context.close().catch((error: unknown) => {
      console.warn("Unable to close notification audio context:", error);
    });
  };
  oscillator.start(now);
  oscillator.stop(now + duration);
}
