import { getChatActor } from "@/lib/chat/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getChatActor();
  if ("response" in context) return context.response;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const channel = context.supabase
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
        if (stopped) return;
        controller.enqueue(encoder.encode("data: {\"type\":\"message\"}\n\n"));
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
      () => {
        if (!stopped) controller.enqueue(encoder.encode("data: {\"type\":\"read\"}\n\n"));
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "work_logs",
        filter: `assigned_to=eq.${context.actor.id}`,
      },
      () => {
        if (!stopped) controller.enqueue(encoder.encode("data: {\"type\":\"task_assigned\"}\n\n"));
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "work_logs",
        filter: `assigned_to=eq.${context.actor.id}`,
      },
      () => {
        if (!stopped) controller.enqueue(encoder.encode("data: {\"type\":\"task_updated\"}\n\n"));
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "work_logs",
        filter: `assigned_by=eq.${context.actor.id}`,
      },
      () => {
        if (!stopped) controller.enqueue(encoder.encode("data: {\"type\":\"task_started\"}\n\n"));
      }
    );

  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!stopped) {
            try {
              controller.enqueue(encoder.encode("event: error\ndata: {}\n\n"));
            } catch {
              // The stream can already be closed by the client disconnecting.
            }
          }
        }
      });
      heartbeat = setInterval(() => {
        if (!stopped) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            stopped = true;
          }
        }
      }, 20_000);
    },
    async cancel() {
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      await context.supabase.removeChannel(channel);
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
