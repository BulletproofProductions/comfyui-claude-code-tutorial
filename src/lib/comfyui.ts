/**
 * ComfyUI API Client
 * Handles all communication with the ComfyUI server
 */

import type { ImageResolution, AspectRatio } from "@/lib/types/generation";

// ==========================================
// Types
// ==========================================

export interface ComfyUIWorkflow {
  [nodeId: string]: {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: { title: string };
  };
}

export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

export interface HistoryOutput {
  images?: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
}

export interface HistoryEntry {
  prompt: [number, string, Record<string, unknown>, Record<string, unknown>];
  outputs: Record<string, HistoryOutput>;
  status: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, Record<string, unknown>]>;
  };
}

export interface WorkflowOptions {
  prompt: string;
  width: number;
  height: number;
  steps?: number | undefined;
  guidance?: number | undefined;
  seed?: number | undefined;
  referenceImageFilename?: string | undefined;
}

// ==========================================
// Resolution Mapping
// ==========================================

const RESOLUTION_MAP: Record<ImageResolution, Record<AspectRatio, { width: number; height: number }>> = {
  "1K": {
    "1:1": { width: 1024, height: 1024 },
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "4:3": { width: 1152, height: 864 },
    "3:4": { width: 864, height: 1152 },
    "21:9": { width: 1344, height: 576 },
  },
  "2K": {
    "1:1": { width: 2048, height: 2048 },
    "16:9": { width: 2560, height: 1440 },
    "9:16": { width: 1440, height: 2560 },
    "4:3": { width: 2304, height: 1728 },
    "3:4": { width: 1728, height: 2304 },
    "21:9": { width: 2688, height: 1152 },
  },
  "4K": {
    "1:1": { width: 4096, height: 4096 },
    "16:9": { width: 3840, height: 2160 },
    "9:16": { width: 2160, height: 3840 },
    "4:3": { width: 4096, height: 3072 },
    "3:4": { width: 3072, height: 4096 },
    "21:9": { width: 5120, height: 2160 },
  },
};

export function getResolutionDimensions(
  resolution: ImageResolution,
  aspectRatio: AspectRatio
): { width: number; height: number } {
  return RESOLUTION_MAP[resolution][aspectRatio];
}

// ==========================================
// ComfyUI Client Class
// ==========================================

export class ComfyUIClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8000";
  }

  /**
   * Queue a workflow prompt for execution
   */
  async queuePrompt(workflow: ComfyUIWorkflow): Promise<QueuePromptResponse> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to queue prompt: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get execution history for a prompt
   */
  async getHistory(promptId: string): Promise<HistoryEntry | null> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`);

    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.status}`);
    }

    const data = await response.json();
    return data[promptId] || null;
  }

  /**
   * Fetch a generated image as a buffer
   */
  async getImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });

    const response = await fetch(`${this.baseUrl}/view?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to get image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Upload a reference image to ComfyUI
   */
  async uploadImage(buffer: Buffer, filename: string): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: "image/png" });
    formData.append("image", blob, filename);
    formData.append("overwrite", "true");

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload image: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Wait for a prompt to complete execution
   * Polls the history endpoint until completion (no timeout - generations can take hours)
   */
  async waitForCompletion(promptId: string): Promise<HistoryEntry> {
    const pollInterval = 500; // 500ms between polls

    while (true) {
      const history = await this.getHistory(promptId);

      if (history && history.status?.completed) {
        return history;
      }

      // Check for errors in status messages
      if (history?.status?.status_str === "error") {
        const errorMessages = history.status.messages
          .filter((msg) => msg[0] === "execution_error")
          .map((msg) => JSON.stringify(msg[1]))
          .join(", ");
        throw new Error(`Workflow execution failed: ${errorMessages || "Unknown error"}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Check if ComfyUI server is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Build a Flux 2 workflow from options
   */
  buildFlux2Workflow(options: WorkflowOptions): ComfyUIWorkflow {
    const {
      prompt,
      width,
      height,
      steps = 20,
      guidance = 4,
      seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      referenceImageFilename,
    } = options;

    // Base workflow structure
    const workflow: ComfyUIWorkflow = {
      // CLIP Text Encode (Positive Prompt)
      "6": {
        inputs: {
          text: prompt,
          clip: ["38", 0],
        },
        class_type: "CLIPTextEncode",
        _meta: { title: "CLIP Text Encode (Positive Prompt)" },
      },
      // VAE Decode
      "8": {
        inputs: {
          samples: ["13", 0],
          vae: ["10", 0],
        },
        class_type: "VAEDecode",
        _meta: { title: "VAE Decode" },
      },
      // Save Image
      "9": {
        inputs: {
          filename_prefix: "Flux2",
          images: ["8", 0],
        },
        class_type: "SaveImage",
        _meta: { title: "Save Image" },
      },
      // Load VAE
      "10": {
        inputs: {
          vae_name: "flux2-vae.safetensors",
        },
        class_type: "VAELoader",
        _meta: { title: "Load VAE" },
      },
      // Load Diffusion Model
      "12": {
        inputs: {
          unet_name: "flux2_dev_fp8mixed.safetensors",
          weight_dtype: "default",
        },
        class_type: "UNETLoader",
        _meta: { title: "Load Diffusion Model" },
      },
      // Sampler Custom Advanced
      "13": {
        inputs: {
          noise: ["25", 0],
          guider: ["22", 0],
          sampler: ["16", 0],
          sigmas: ["48", 0],
          latent_image: ["47", 0],
        },
        class_type: "SamplerCustomAdvanced",
        _meta: { title: "SamplerCustomAdvanced" },
      },
      // KSampler Select
      "16": {
        inputs: {
          sampler_name: "euler",
        },
        class_type: "KSamplerSelect",
        _meta: { title: "KSamplerSelect" },
      },
      // Basic Guider
      "22": {
        inputs: {
          model: ["12", 0],
          conditioning: ["26", 0], // Will be modified if reference image is used
        },
        class_type: "BasicGuider",
        _meta: { title: "BasicGuider" },
      },
      // Random Noise
      "25": {
        inputs: {
          noise_seed: seed,
        },
        class_type: "RandomNoise",
        _meta: { title: "RandomNoise" },
      },
      // Flux Guidance
      "26": {
        inputs: {
          guidance: guidance,
          conditioning: ["6", 0],
        },
        class_type: "FluxGuidance",
        _meta: { title: "FluxGuidance" },
      },
      // CLIP Loader
      "38": {
        inputs: {
          clip_name: "mistral_3_small_flux2_bf16.safetensors",
          type: "flux2",
          device: "default",
        },
        class_type: "CLIPLoader",
        _meta: { title: "Load CLIP" },
      },
      // Empty Flux 2 Latent Image
      "47": {
        inputs: {
          width: width,
          height: height,
          batch_size: 1,
        },
        class_type: "EmptyFlux2LatentImage",
        _meta: { title: "Empty Flux 2 Latent" },
      },
      // Flux2 Scheduler
      "48": {
        inputs: {
          steps: steps,
          width: width,
          height: height,
        },
        class_type: "Flux2Scheduler",
        _meta: { title: "Flux2Scheduler" },
      },
    };

    // Add reference image nodes if a reference image is provided
    if (referenceImageFilename) {
      // Reference Latent
      workflow["43"] = {
        inputs: {
          conditioning: ["26", 0],
          latent: ["44", 0],
        },
        class_type: "ReferenceLatent",
        _meta: { title: "ReferenceLatent" },
      };
      // VAE Encode for reference
      workflow["44"] = {
        inputs: {
          pixels: ["45", 0],
          vae: ["10", 0],
        },
        class_type: "VAEEncode",
        _meta: { title: "VAE Encode" },
      };
      // Image Scale To Total Pixels
      workflow["45"] = {
        inputs: {
          upscale_method: "lanczos",
          megapixels: 1,
          image: ["46", 0],
        },
        class_type: "ImageScaleToTotalPixels",
        _meta: { title: "ImageScaleToTotalPixels" },
      };
      // Load Image
      workflow["46"] = {
        inputs: {
          image: referenceImageFilename,
        },
        class_type: "LoadImage",
        _meta: { title: "Load Image" },
      };

      // Update BasicGuider to use ReferenceLatent output
      const basicGuider = workflow["22"];
      if (basicGuider) {
        basicGuider.inputs.conditioning = ["43", 0];
      }
    }

    return workflow;
  }

  /**
   * Get WebSocket URL for real-time progress updates
   */
  getWebSocketUrl(): string {
    const httpUrl = new URL(this.baseUrl);
    const wsProtocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${httpUrl.host}/ws`;
  }
}

// Export singleton instance
export const comfyui = new ComfyUIClient();
