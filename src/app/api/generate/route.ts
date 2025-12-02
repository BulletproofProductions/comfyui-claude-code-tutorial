import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { comfyui, getResolutionDimensions } from "@/lib/comfyui";
import { db } from "@/lib/db";
import { generations, generatedImages, generationHistory, avatars } from "@/lib/schema";
import { upload, readFromStorage } from "@/lib/storage";
import type {
  GenerationSettings,
  AvatarType,
  GenerationWithImages,
  ImageResolution,
  AspectRatio,
} from "@/lib/types/generation";


interface ReferenceImage {
  imageUrl: string;
  type: AvatarType;
  name: string;
}

interface GenerateRequestBody {
  prompt: string;
  settings: GenerationSettings;
  referenceImages?: {
    avatarId: string;
    type: AvatarType;
  }[];
}

/**
 * POST /api/generate
 * Start a new image generation using ComfyUI
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const { prompt, settings, referenceImages = [] } = body;

    // Validate required fields
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (!settings || !settings.resolution || !settings.aspectRatio) {
      return NextResponse.json(
        { error: "Settings with resolution and aspectRatio are required" },
        { status: 400 }
      );
    }

    // Validate settings
    const validResolutions = ["1K", "2K", "4K"];
    const validAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];
    const validImageCounts = [1, 2, 3, 4];

    if (!validResolutions.includes(settings.resolution)) {
      return NextResponse.json(
        { error: "Invalid resolution" },
        { status: 400 }
      );
    }

    if (!validAspectRatios.includes(settings.aspectRatio)) {
      return NextResponse.json(
        { error: "Invalid aspect ratio" },
        { status: 400 }
      );
    }

    if (settings.imageCount && !validImageCounts.includes(settings.imageCount)) {
      return NextResponse.json(
        { error: "Invalid image count. Must be 1-4" },
        { status: 400 }
      );
    }

    // Validate optional ComfyUI settings
    if (settings.steps !== undefined && (settings.steps < 1 || settings.steps > 50)) {
      return NextResponse.json(
        { error: "Steps must be between 1 and 50" },
        { status: 400 }
      );
    }

    if (settings.guidance !== undefined && (settings.guidance < 1 || settings.guidance > 10)) {
      return NextResponse.json(
        { error: "Guidance must be between 1 and 10" },
        { status: 400 }
      );
    }

    // Check if ComfyUI is available
    const isComfyUIAvailable = await comfyui.healthCheck();
    if (!isComfyUIAvailable) {
      return NextResponse.json(
        { error: "ComfyUI server is not running. Please start ComfyUI and try again." },
        { status: 503 }
      );
    }

    // Get avatar details for reference images
    let avatarDetails: ReferenceImage[] = [];
    if (referenceImages.length > 0) {
      const avatarIds = referenceImages.map((r) => r.avatarId);
      const avatarRecords = await db
        .select()
        .from(avatars)
        .where(inArray(avatars.id, avatarIds));

      // Map avatar records to reference images
      avatarDetails = referenceImages
        .map((ref) => {
          const avatar = avatarRecords.find((a) => a.id === ref.avatarId);
          if (!avatar) return null;
          return {
            imageUrl: avatar.imageUrl,
            type: avatar.avatarType as AvatarType,
            name: avatar.name,
          } as ReferenceImage;
        })
        .filter((a): a is ReferenceImage => a !== null);
    }

    // Create the generation record with 'processing' status
    const [generation] = await db
      .insert(generations)
      .values({
        prompt: prompt.trim(),
        settings: settings,
        status: "processing",
      })
      .returning();

    if (!generation) {
      return NextResponse.json(
        { error: "Failed to create generation record" },
        { status: 500 }
      );
    }

    // Store the initial user message in history
    await db.insert(generationHistory).values({
      generationId: generation.id,
      role: "user",
      content: prompt.trim(),
      imageUrls: avatarDetails.map((a) => a.imageUrl),
    });

    try {
      // Get dimensions from resolution and aspect ratio
      const { width, height } = getResolutionDimensions(
        settings.resolution as ImageResolution,
        settings.aspectRatio as AspectRatio
      );

      // Upload reference image to ComfyUI if provided
      let referenceImageFilename: string | undefined;
      if (avatarDetails.length > 0 && avatarDetails[0]) {
        const refImage = avatarDetails[0];
        // Read the reference image from storage
        const imageBuffer = await readFromStorage(refImage.imageUrl);
        const uploadResult = await comfyui.uploadImage(
          imageBuffer,
          `ref-${generation.id}-${Date.now()}.png`
        );
        referenceImageFilename = uploadResult.name;
      }

      // Generate images (loop for imageCount)
      const imageCount = settings.imageCount || 1;
      const savedImages = [];

      for (let i = 0; i < imageCount; i++) {
        // Build the workflow
        const workflow = comfyui.buildFlux2Workflow({
          prompt: prompt.trim(),
          width,
          height,
          steps: settings.steps,
          guidance: settings.guidance,
          seed: settings.seed !== undefined ? settings.seed + i : undefined, // Increment seed for each image
          referenceImageFilename,
        });

        // Queue the prompt
        const queueResult = await comfyui.queuePrompt(workflow);

        // Wait for completion
        const history = await comfyui.waitForCompletion(queueResult.prompt_id);

        // Get the generated images from the output
        const outputNode = Object.values(history.outputs).find((output) => output.images?.length);
        if (!outputNode?.images?.length) {
          throw new Error("No images in generation output");
        }

        // Fetch and save each generated image
        for (const imageInfo of outputNode.images) {
          const imageBuffer = await comfyui.getImage(
            imageInfo.filename,
            imageInfo.subfolder,
            imageInfo.type
          );

          // Convert buffer to base64 for storage
          const timestamp = Date.now();
          const filename = `gen-${generation.id}-${i}-${timestamp}.png`;

          // Upload to storage
          const uploadResult = await upload(imageBuffer, filename, "generations");

          // Save to database
          const [savedImage] = await db
            .insert(generatedImages)
            .values({
              generationId: generation.id,
              imageUrl: uploadResult.url,
            })
            .returning();

          if (savedImage) {
            savedImages.push(savedImage);
          }
        }
      }

      if (savedImages.length === 0) {
        throw new Error("No images were generated");
      }

      // Store the assistant response in history
      await db.insert(generationHistory).values({
        generationId: generation.id,
        role: "assistant",
        content: `Generated ${savedImages.length} image(s) successfully`,
        imageUrls: savedImages.map((img) => img.imageUrl),
      });

      // Update generation status to completed
      await db
        .update(generations)
        .set({ status: "completed" })
        .where(eq(generations.id, generation.id));

      // Fetch the updated generation with images
      const [updatedGeneration] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));

      const generationWithImages: GenerationWithImages = {
        id: updatedGeneration!.id,
        prompt: updatedGeneration!.prompt,
        settings: updatedGeneration!.settings as GenerationSettings,
        status: "completed",
        errorMessage: null,
        createdAt: updatedGeneration!.createdAt,
        updatedAt: updatedGeneration!.updatedAt,
        images: savedImages.map((img) => ({
          id: img.id,
          generationId: img.generationId,
          imageUrl: img.imageUrl,
          createdAt: img.createdAt,
        })),
      };

      return NextResponse.json({ generation: generationWithImages }, { status: 201 });
    } catch (genError) {
      // Update generation status to failed
      const errorMessage = genError instanceof Error ? genError.message : "Generation failed";
      await db
        .update(generations)
        .set({
          status: "failed",
          errorMessage: errorMessage,
        })
        .where(eq(generations.id, generation.id));

      return NextResponse.json(
        {
          error: errorMessage,
          generation: {
            id: generation.id,
            status: "failed",
            errorMessage: errorMessage,
          },
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error generating images:", error);
    const message = error instanceof Error ? error.message : "Failed to generate images";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
