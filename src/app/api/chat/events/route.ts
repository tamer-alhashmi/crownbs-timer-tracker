import { getChatActor } from "@/lib/chat/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getChatActor();
  if ("response" in context) return context.response;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let channelCleanup: Promise<unknown> | null = null;
  let channel: ReturnType<typeof context.supabase.channel>;

  const stop = () => {
    if (!stopped) {
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
    }
    channelCleanup ??= context.supabase.removeChannel(channel);
    return channelCleanup;
  };

  const send = (event: string) => {
    if (stopped || !controller) return false;
    try {
      controller.enqueue(encoder.encode(event));
      return true;
    } catch {
      void stop();
      return false;
    }
  };

  channel = context.supabase
    .channel(`private-chat-notifications:${context.actor.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${context.actor.id}`,
      },
      (payload) => {
        if (!send("data: {\"type\":\"message\"}\n\n")) return;
        const messageId = payload.new.id;
        if (typeof messageId === "string") {
          void context.supabase
            .from("messages")
            .update({ delivered_at: new Date().toISOString() })
            .eq("id", messageId)
            .eq("receiver_id", context.actor.id)
            .is("delivered_at", null)
            .then(({ error }) => {
              if (error) console.error("Chat delivery receipt update failed:", error.message);
            });
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `sender_id=eq.${context.actor.id}`,
      },
      () => send("data: {\"type\":\"read\"}\n\n")
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "work_logs",
        filter: `assigned_to=eq.${context.actor.id}`,
      },
      () => send("data: {\"type\":\"task_assigned\"}\n\n")
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "work_logs",
        filter: `assigned_to=eq.${context.actor.id}`,
      },
      () => send("data: {\"type\":\"task_updated\"}\n\n")
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "work_logs",
        filter: `assigned_by=eq.${context.actor.id}`,
      },
      () => send("data: {\"type\":\"task_started\"}\n\n")
    );

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (send("event: error\ndata: {}\n\n")) {
            try {
              controller?.close();
            } catch {
              void stop();
              return;
            }
          }
          void stop();
        }
      });
      heartbeat = setInterval(() => {
        send(": keepalive\n\n");
      }, 20_000);
    },
    async cancel() {
      await stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
