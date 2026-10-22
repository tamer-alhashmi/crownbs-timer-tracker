"use client";

import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatContact } from "@/lib/chat/types";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { logChatError } from "./chatErrors";
import { useChatStore } from "./chatStore";
import { fetchContacts } from "./chatApi";

type CallState = {
  contact: ChatContact;
  callId: string;
  incoming: boolean;
  status: "ringing" | "connecting" | "active";
  offer?: RTCSessionDescriptionInit;
};

type Signal = {
  type: "invite" | "accept" | "answer" | "ice" | "end" | "decline";
  callId: string;
  fromId: string;
  toId: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function clock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function ActiveCallModal({ userId }: { userId: string }) {
  const [call, setCall] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const personalChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const peerChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const callRef = useRef<CallState | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const openChat = useChatStore((state) => state.openChat);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    callRef.current = call;
    if (call?.status === "active") {
      const startAt = Date.now();
      const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startAt) / 1000)), 1000);
      return () => clearInterval(timer);
    }
  }, [call]);

  const sendSignal = useCallback(async (signal: Omit<Signal, "fromId" | "toId"> & { toId: string }) => {
    const channel = peerChannelRef.current;
    if (!channel) return;
    try {
      const sendStatus = await channel.send({
        type: "broadcast",
        event: "signal",
        payload: { ...signal, fromId: userId },
      });
      if (sendStatus !== "ok") throw new Error(`Realtime call signal returned ${sendStatus}`);
    } catch (cause) {
      logChatError(cause);
      setError("We couldn't connect the call. Please try again.");
    }
  }, [userId]);

  const stopCall = useCallback(async (notifyPeer: boolean) => {
    const current = callRef.current;
    if (notifyPeer && current) {
      await sendSignal({ type: "end", callId: current.callId, toId: current.contact.id });
    }
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (peerChannelRef.current) {
      try {
        await supabase.removeChannel(peerChannelRef.current);
      } catch (cause) {
        logChatError(cause);
      }
    }
    peerChannelRef.current = null;
    pendingCandidatesRef.current = [];
    setCall(null);
    setMuted(false);
  }, [sendSignal, supabase]);

  const ensurePeerChannel = useCallback(async (contactId: string) => {
    if (peerChannelRef.current) return;
    const channel = supabase.channel(`chat:call:${contactId}`);
    peerChannelRef.current = channel;
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Call signaling unavailable"));
      });
    });
  }, [supabase]);

  const createPeer = useCallback(async (contactId: string) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerRef.current = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        const current = callRef.current;
        if (current) void sendSignal({
          type: "ice",
          callId: current.callId,
          toId: contactId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    peer.ontrack = (event) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = event.streams[0];
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        setCall((current) => current ? { ...current, status: "active" } : current);
      } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        if (peer.connectionState === "failed") void stopCall(false);
      }
    };
    return peer;
  }, [sendSignal, stopCall]);

  const addLocalTracks = useCallback(async (peer: RTCPeerConnection) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  }, []);

  const handleSignal = useCallback(async (signal: Signal) => {
    if (signal.toId !== userId) return;
    const current = callRef.current;
    if (signal.type === "invite" && signal.offer && !current) {
      try {
        const { contacts } = await fetchContacts();
        const contact = contacts.find((candidate) => candidate.id === signal.fromId && candidate.conversation_type !== "group");
        if (!contact) return;
        const incoming: CallState = { contact, callId: signal.callId, incoming: true, status: "ringing", offer: signal.offer };
        callRef.current = incoming;
        setSeconds(0);
        setCall(incoming);
        openChat(contact);
      } catch (cause) {
        logChatError(cause);
      }
      return;
    }
    if (!current || current.callId !== signal.callId || current.contact.id !== signal.fromId) return;
    try {
      if (signal.type === "accept") {
        const peer = peerRef.current;
        if (!peer) return;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await sendSignal({ type: "invite", callId: current.callId, toId: current.contact.id, offer });
        return;
      }
      if (signal.type === "answer" && signal.answer && peerRef.current) {
        await peerRef.current.setRemoteDescription(signal.answer);
        setCall((active) => active ? { ...active, status: "connecting" } : active);
        for (const candidate of pendingCandidatesRef.current.splice(0)) await peerRef.current.addIceCandidate(candidate);
      }
      if (signal.type === "ice" && signal.candidate && peerRef.current) {
        if (peerRef.current.remoteDescription) await peerRef.current.addIceCandidate(signal.candidate);
        else pendingCandidatesRef.current.push(signal.candidate);
      } else if (signal.type === "ice" && signal.candidate) {
        pendingCandidatesRef.current.push(signal.candidate);
      }
      if (signal.type === "end" || signal.type === "decline") await stopCall(false);
    } catch (cause) {
      logChatError(cause);
      setError("The call couldn't connect. Check your microphone and internet connection.");
    }
  }, [openChat, sendSignal, stopCall, userId]);

  useEffect(() => {
    const channel = supabase.channel(`chat:call:${userId}`)
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        void handleSignal(payload as Signal);
      });
    personalChannelRef.current = channel;
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        logChatError(new Error("Call signaling connection unavailable"));
      }
    });
    return () => {
      void supabase.removeChannel(channel).catch(logChatError);
      personalChannelRef.current = null;
    };
  }, [handleSignal, supabase, userId]);

  useEffect(() => {
    const start = (event: Event) => {
      const contact = (event as CustomEvent<ChatContact>).detail;
      if (!contact || contact.conversation_type === "group" || callRef.current) return;
      const current: CallState = { contact, callId: crypto.randomUUID(), incoming: false, status: "connecting" };
      callRef.current = current;
      setSeconds(0);
      setCall(current);
      setError("");
      void (async () => {
        try {
          await ensurePeerChannel(contact.id);
          const peer = await createPeer(contact.id);
          await addLocalTracks(peer);
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await sendSignal({
            type: "invite",
            callId: current.callId,
            toId: contact.id,
            offer,
          });
          setCall((value) => value ? { ...value, status: "ringing" } : value);
        } catch (cause) {
          logChatError(cause);
          setError(cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Please allow microphone access to start a call."
            : "We couldn't start the call. Check your microphone and connection.");
          await stopCall(false);
        }
      })();
    };
    window.addEventListener("chat:start-call", start);
    return () => window.removeEventListener("chat:start-call", start);
  }, [addLocalTracks, createPeer, ensurePeerChannel, sendSignal, stopCall]);

  const accept = async () => {
    if (!call?.offer) return;
    try {
      await ensurePeerChannel(call.contact.id);
      const peer = await createPeer(call.contact.id);
      await addLocalTracks(peer);
      await peer.setRemoteDescription(call.offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal({ type: "answer", callId: call.callId, toId: call.contact.id, answer });
      for (const candidate of pendingCandidatesRef.current.splice(0)) await peer.addIceCandidate(candidate);
      setCall({ ...call, incoming: false, status: "connecting" });
    } catch (cause) {
      logChatError(cause);
      setError("The call couldn't connect. Check your microphone and internet connection.");
    }
  };

  if (!call && !error) return null;
  return (
    <>
      {call && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-label={call.incoming ? "Incoming voice call" : "Voice call"} className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <audio ref={remoteAudioRef} autoPlay />
            <UserAvatar name={call.contact.full_name} avatarUrl={call.contact.avatar_url} role={call.contact.role} className="mx-auto h-20 w-20 bg-emerald-100 text-2xl font-semibold text-emerald-900" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">{call.contact.full_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{call.incoming ? "Incoming voice call" : call.status === "active" ? `Connected · ${clock(seconds)}` : call.status === "ringing" ? "Calling…" : "Connecting…"}</p>
            {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
            <div className="mt-6 flex justify-center gap-4">
              {call.incoming ? (
                <button type="button" onClick={() => void accept()} className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white" aria-label="Accept call"><Phone className="h-5 w-5" /></button>
              ) : call.status === "active" ? (
                <button type="button" onClick={() => {
                  const nextMuted = !muted;
                  setMuted(nextMuted);
                  localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
                }} className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700" aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
              ) : null}
              <button type="button" onClick={() => void stopCall(true)} className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white" aria-label={call.incoming ? "Decline call" : "End call"}><PhoneOff className="h-5 w-5" /></button>
            </div>
          </section>
        </div>
      )}
      {!call && error && <div role="alert" className="fixed bottom-24 right-4 z-[100] max-w-xs rounded-xl bg-rose-50 p-3 text-sm text-rose-800 shadow-lg">{error}</div>}
    </>
  );
}
