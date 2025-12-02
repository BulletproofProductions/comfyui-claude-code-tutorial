"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ProgressState {
  step: number;
  totalSteps: number;
  percentage: number;
  status: string;
  isConnected: boolean;
  error: string | null;
}

interface GenerationProgressProps {
  promptId: string | null;
  isGenerating: boolean;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export function GenerationProgress({
  promptId,
  isGenerating,
  onComplete,
  onError,
}: GenerationProgressProps) {
  const [progress, setProgress] = useState<ProgressState>({
    step: 0,
    totalSteps: 20,
    percentage: 0,
    status: "Initializing...",
    isConnected: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCompletedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Reset progress when not generating
  useEffect(() => {
    if (!isGenerating || !promptId) {
      cleanup();
      hasCompletedRef.current = false;
    }
  }, [isGenerating, promptId, cleanup]);

  useEffect(() => {
    if (!isGenerating || !promptId) {
      return;
    }

    // Avoid duplicate connections
    if (eventSourceRef.current) {
      return;
    }

    hasCompletedRef.current = false;

    // Connect to SSE endpoint
    const eventSource = new EventSource(`/api/generate/progress?promptId=${promptId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "connected":
            setProgress((prev) => ({
              ...prev,
              isConnected: true,
              status: data.status || "Connected",
            }));
            break;

          case "progress":
            setProgress((prev) => ({
              ...prev,
              step: data.step ?? prev.step,
              totalSteps: data.totalSteps ?? prev.totalSteps,
              percentage: data.percentage ?? prev.percentage,
              status: data.status || prev.status,
              isConnected: true,
              error: null,
            }));
            break;

          case "complete":
            if (!hasCompletedRef.current) {
              hasCompletedRef.current = true;
              setProgress({
                step: data.totalSteps || 20,
                totalSteps: data.totalSteps || 20,
                percentage: 100,
                status: data.status || "Complete!",
                isConnected: true,
                error: null,
              });
              cleanup();
              onComplete?.();
            }
            break;

          case "error":
            setProgress((prev) => ({
              ...prev,
              error: data.message || "An error occurred",
              status: data.status || "Error",
            }));
            cleanup();
            onError?.(data.message || "An error occurred");
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Only show error if we haven't completed successfully
      if (!hasCompletedRef.current) {
        setProgress((prev) => ({
          ...prev,
          isConnected: false,
          error: "Connection lost. Generation may still be in progress.",
        }));
      }
      cleanup();
    };

    return cleanup;
  }, [promptId, isGenerating, cleanup, onComplete, onError]);

  if (!isGenerating) {
    return null;
  }

  return (
    <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{progress.status}</span>
      </div>

      <Progress value={progress.percentage} className="h-2" />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {progress.step > 0
            ? `Step ${progress.step}/${progress.totalSteps}`
            : "Preparing..."}
        </span>
        <span>{progress.percentage}%</span>
      </div>

      {progress.error && (
        <p className="text-xs text-destructive mt-2">{progress.error}</p>
      )}
    </div>
  );
}
