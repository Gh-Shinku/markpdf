import { afterEach, describe, expect, it, vi } from "vitest";
import { streamPlaygroundChatMessage } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamPlaygroundChatMessage", () => {
  it("reads delta and final SSE events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse("delta", { text: "hello" }),
          sse("delta", { text: " world" }),
          sse("final", finalPayload()),
        ]),
      ),
    );

    const events = [];
    for await (const event of streamPlaygroundChatMessage("chat-1", "provider-1", {
      id: "user-1",
      role: "user",
      content: "prompt",
      attachments: [],
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "delta", text: "hello" });
    expect(events[1]).toEqual({ type: "delta", text: " world" });
    expect(events[2]).toMatchObject({
      type: "final",
      response: { message: { role: "assistant", content: "hello world" } },
    });
  });

  it("throws on SSE error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([sse("error", { detail: "failed" })])),
    );

    await expect(async () => {
      for await (const event of streamPlaygroundChatMessage("chat-1", "provider-1", {
        id: "user-1",
        role: "user",
        content: "prompt",
        attachments: [],
      })) {
        void event;
        // consume stream
      }
    }).rejects.toThrow("failed");
  });
});

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function finalPayload() {
  return {
    chats: [
      {
        id: "chat-1",
        title: "Chat",
        created_at: "2026-08-05T00:00:00Z",
        updated_at: "2026-08-05T00:00:00Z",
      },
    ],
    active_chat_id: "chat-1",
    chat: {
      id: "chat-1",
      title: "Chat",
      provider_id: "provider-1",
      created_at: "2026-08-05T00:00:00Z",
      updated_at: "2026-08-05T00:00:00Z",
      messages: [],
    },
    message: {
      role: "assistant",
      content: "hello world",
    },
  };
}
