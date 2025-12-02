import { comfyui } from "@/lib/comfyui";

export const dynamic = "force-dynamic";

interface ProgressUpdate {
  type: "progress" | "complete" | "error" | "connected";
  step?: number;
  totalSteps?: number;
  percentage?: number;
  status?: string;
  message?: string;
}

/**
 * GET /api/generate/progress
 * Server-Sent Events endpoint for real-time generation progress
 * Polls ComfyUI history endpoint for progress updates
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const promptId = searchParams.get("promptId");

  if (!promptId) {
    return new Response(JSON.stringify({ error: "promptId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isAborted = false;
      let pollInterval: ReturnType<typeof setTimeout> | null = null;

      const sendEvent = (data: ProgressUpdate) => {
        if (isAborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          isAborted = true;
        }
      };

      const cleanup = () => {
        isAborted = true;
        if (pollInterval) {
          clearTimeout(pollInterval);
          pollInterval = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Handle client disconnect
      request.signal.addEventListener("abort", cleanup);

      // Send initial connected event
      sendEvent({ type: "connected", status: "Connecting to ComfyUI..." });

      // Check if ComfyUI is available
      const isAvailable = await comfyui.healthCheck();
      if (!isAvailable) {
        sendEvent({
          type: "error",
          message: "ComfyUI is not running",
          status: "Error",
        });
        cleanup();
        return;
      }

      sendEvent({ type: "progress", status: "Connected to ComfyUI" });

      // Poll for completion
      const pollForProgress = async () => {
        if (isAborted) return;

        try {
          const history = await comfyui.getHistory(promptId);

          if (history) {
            if (history.status?.completed) {
              sendEvent({
                type: "complete",
                percentage: 100,
                status: "Generation complete!",
              });
              cleanup();
              return;
            }

            if (history.status?.status_str === "error") {
              const errorMessages = history.status.messages
                .filter((msg) => msg[0] === "execution_error")
                .map((msg) => JSON.stringify(msg[1]))
                .join(", ");
              sendEvent({
                type: "error",
                message: errorMessages || "Generation failed",
                status: "Error",
              });
              cleanup();
              return;
            }
          }

          // Continue polling
          sendEvent({
            type: "progress",
            status: "Generating...",
          });

          pollInterval = setTimeout(pollForProgress, 1000);
        } catch (error) {
          sendEvent({
            type: "error",
            message: error instanceof Error ? error.message : "Polling failed",
            status: "Error",
          });
          cleanup();
        }
      };

      // Start polling
      pollForProgress();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
