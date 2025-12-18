"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ProgressState {
  step: number;
  totalSteps: number;
  percentage: number;
  status: string;
  isConnected: boolean;
  error: string | null;
  currentImageIndex?: number;
  totalImages?: number;
  isStalled?: boolean;
}

interface GenerationProgressProps {
  promptId: string | null;
  isGenerating: boolean;
  currentImageIndex?: number;
  totalImages?: number;
  onComplete?: (() => void) | undefined;
  onError?: ((error: string) => void) | undefined;
}

// Timeout in milliseconds for detecting stalled progress (5 minutes)
const STALL_DETECTION_TIMEOUT = 5 * 60 * 1000;

export function GenerationProgress({
  promptId,
  isGenerating,
  currentImageIndex = 1,
  totalImages = 1,
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
    currentImageIndex: currentImageIndex,
    totalImages: totalImages,
    isStalled: false,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCompletedRef = useRef(false);
  const stallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressTimeRef = useRef<number>(Date.now());

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
  }, []);

  // Reset stall timeout on progress update
  const resetStallTimeout = useCallback(() => {
    lastProgressTimeRef.current = Date.now();
    
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
    }

    stallTimeoutRef.current = setTimeout(() => {
      if (progress.percentage > 0 && progress.percentage < 100) {
        console.warn('[GenerationProgress] Progress stalled detected after', STALL_DETECTION_TIMEOUT / 1000, 'seconds');
        setProgress((prev) => ({
          ...prev,
          isStalled: true,
          error: `Generation appears to be stalled. Last update was at ${progress.percentage}% completion.`,
          status: "⚠️ Progress Stalled - Check ComfyUI Server",
        }));
      }
    }, STALL_DETECTION_TIMEOUT);
  }, [progress.percentage]);

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
    lastProgressTimeRef.current = Date.now();

    // Connect to SSE endpoint with image tracking parameters
    const eventSource = new EventSource(
      `/api/generate/progress?promptId=${promptId}&imageIndex=${currentImageIndex}&totalImages=${totalImages}`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "connected":
            resetStallTimeout();
            setProgress((prev) => ({
              ...prev,
              isConnected: true,
              status: data.status || "Connected",
              currentImageIndex: data.imageIndex ?? currentImageIndex,
              totalImages: data.totalImages ?? totalImages,
              isStalled: false,
              error: null,
            }));
            break;

          case "progress":
            resetStallTimeout();
            setProgress((prev) => ({
              ...prev,
              step: data.currentStep ?? prev.step,
              totalSteps: data.totalSteps ?? prev.totalSteps,
              percentage: data.percentage ?? prev.percentage,
              status: data.status || prev.status,
              isConnected: true,
              error: null,
              currentImageIndex: data.imageIndex ?? currentImageIndex,
              totalImages: data.totalImages ?? totalImages,
              isStalled: false,
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
                currentImageIndex: data.imageIndex ?? currentImageIndex,
                totalImages: data.totalImages ?? totalImages,
                isStalled: false,
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
              isStalled: false,
            }));
            cleanup();
            onError?.(data.message || "An error occurred");
            break;
        }
      } catch (error) {
        console.error('[GenerationProgress] Error parsing SSE event:', error);
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

    // Set initial stall timeout
    resetStallTimeout();

    return cleanup;
  }, [promptId, isGenerating, currentImageIndex, totalImages, cleanup, onComplete, onError, resetStallTimeout]);

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

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>
            Image {progress.currentImageIndex ?? 1} of {progress.totalImages ?? 1} • Step {progress.step}/{progress.totalSteps}
          </span>
          <span className="font-semibold text-foreground">{progress.percentage}%</span>
        </div>
      </div>

      {progress.isStalled && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded">
          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-yellow-700 dark:text-yellow-200">
            Generation appears stalled. Ensure ComfyUI is running and check server logs.
          </p>
        </div>
      )}

      {progress.error && (
        <p className="text-xs text-destructive mt-2">{progress.error}</p>
      )}
    </div>
  );
}
