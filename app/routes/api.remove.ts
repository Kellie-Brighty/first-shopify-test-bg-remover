import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. Authenticate via App Proxy to ensure the request is from your store
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Extract the image from the multi-part form data
  const formData = await request.formData();
  const imageFile = formData.get("image") as File;

  if (!imageFile) {
    return Response.json({ error: "No image provided" }, { status: 400 });
  }

  // 3. Convert File to Buffer for processing
  const arrayBuffer = await imageFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    // 4. Send image to Remove.bg API
    // IMPORTANT: Make sure to add REMOVE_BG_API_KEY to your .env file
    const apiKey = process.env.REMOVE_BG_API_KEY;
    
    if (!apiKey) {
      console.error("Missing REMOVE_BG_API_KEY environment variable");
      return Response.json(
        { error: "Background removal service not configured" }, 
        { status: 500 }
      );
    }

    const { removeBackgroundFromImageBase64 } = await import('remove.bg');
    
    // Convert buffer to base64 for the API
    const base64img = buffer.toString('base64');
    
    const result = await removeBackgroundFromImageBase64({
      base64img,
      apiKey: apiKey,
      size: "regular",
      type: "auto",
    });

    const processedImageBuffer = Buffer.from(result.base64img, 'base64');

    // 5. Return the processed image directly as a blob
    return new Response(processedImageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": processedImageBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error from Remove.bg API:", error);
    return Response.json(
      { error: "Failed to process image" }, 
      { status: 500 }
    );
  }
};