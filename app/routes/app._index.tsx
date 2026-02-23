import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface ProductEdge {
  node: {
    id: string;
    title: string;
    images: {
      edges: Array<{
        node: {
          url: string;
          altText: string | null;
        };
      }>;
    };
  };
}

interface ProcessedProduct {
  id: string;
  title: string;
  imageUrl: string;
  imageAlt: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const response = await admin.graphql(
    `#graphql
    query GetProductsWithImages($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            images(first: 1) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        first: 15,
      },
    }
  );

  const data = await response.json();
  const rawProducts = data.data?.products?.edges || [];
  
  const products: ProcessedProduct[] = rawProducts.map((edge: ProductEdge) => {
    const node = edge.node;
    const imageNode = node.images.edges[0]?.node;
    return {
      id: node.id,
      title: node.title,
      imageUrl: imageNode?.url || null,
      imageAlt: imageNode?.altText || node.title,
    };
  }).filter((p: { imageUrl: string | null }) => p.imageUrl !== null) as ProcessedProduct[];

  return { products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const imageFile = formData.get("image") as File | null;
  const imageUrl = formData.get("imageUrl") as string | null;

  if ((!imageFile || imageFile.size === 0) && !imageUrl) {
    return Response.json({ error: "No image provided" }, { status: 400 });
  }

  try {
    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Background removal service not configured (missing REMOVE_BG_API_KEY)." },
        { status: 500 }
      );
    }

    const { removeBackgroundFromImageBase64, removeBackgroundFromImageUrl } = await import("remove.bg");
    let base64img = "";
    
    if (imageFile && imageFile.size > 0) {
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      base64img = buffer.toString("base64");
    }

    const result = base64img 
      ? await removeBackgroundFromImageBase64({
          base64img,
          apiKey: apiKey,
          size: "regular",
          type: "auto",
        })
      : await removeBackgroundFromImageUrl({
          url: imageUrl!,
          apiKey: apiKey,
          size: "regular",
          type: "auto",
        });

    // We return the processed base64 data to display in an <img> tag.
    return { 
      success: true, 
      processedImageBase64: result.base64img,
      originalName: imageFile && imageFile.name ? imageFile.name : (imageUrl ? "Store Product Image" : "Processed Image")
    };
  } catch (error: unknown) {
    console.error("Error from Remove.bg API:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: "Failed to process image: " + errorMessage },
      { status: 500 }
    );
  }
};

import appStyles from "../app.css?url";

export const links = () => [
  { rel: "stylesheet", href: appStyles },
];

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isLoading = 
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data && "error" in fetcher.data) {
      shopify.toast.show(fetcher.data.error as string, { isError: true });
    } else if (fetcher.data && "success" in fetcher.data) {
      shopify.toast.show("Background removed successfully!");
    }
  }, [fetcher.data, shopify]);

  const processFile = (file: File) => {
    setSelectedImageUrl(null);
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith("image/")) {
        processFile(droppedFile);
      } else {
        shopify.toast.show("Please drop a valid image file", { isError: true });
      }
    }
  };

  const handleRemoveBg = () => {
    if (!selectedFile && !selectedImageUrl) return;

    const formData = new FormData();
    if (selectedFile) {
      formData.append("image", selectedFile);
    } else if (selectedImageUrl) {
      formData.append("imageUrl", selectedImageUrl);
    }
    fetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const clearSelection = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setSelectedFile(null);
    setSelectedImageUrl(null);
    setPreviewUrl(null);
    
    // Clear the input value so the same file can be selected again
    const fileInput = document.getElementById("file-upload") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  const selectStoreProduct = (url: string) => {
    clearSelection();
    setSelectedImageUrl(url);
    setPreviewUrl(url); // Show the URL as the preview directly
  };

  return (
    <div className="premium-container">
      <div className="title-section">
        <h1 className="main-heading">Background <span>Remover</span></h1>
        <p className="sub-heading">Instantly remove backgrounds using AI. Upload an image to get started.</p>
      </div>

      <main className="glass-panel">
        {products && products.length > 0 && (
          <section className="store-products-section">
            <h3 className="section-subtitle">Or select a store product</h3>
            <div className="product-carousel">
              {products.map((p: ProcessedProduct) => (
                <button
                  key={p.id}
                  className={`product-thumbnail glass-inner ${selectedImageUrl === p.imageUrl ? 'selected' : ''}`}
                  onClick={() => selectStoreProduct(p.imageUrl)}
                  type="button"
                >
                  <img src={p.imageUrl} alt={p.imageAlt} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="upload-section">
          <div className="file-upload-wrapper">
            <input
              type="file"
              id="file-upload"
              accept="image/*"
              className="file-input"
              onChange={handleFileChange}
            />
            <label 
              htmlFor="file-upload" 
              className={`file-input-label glass-inner ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                Click to browse or drag image here
              </span>
              <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
                Supports PNG, JPG, JPEG
              </span>
              {(selectedFile || selectedImageUrl) && (
                <div className="file-name-wrapper">
                  <span className="file-name">{selectedFile ? selectedFile.name : "Store Product"}</span>
                  <button 
                    type="button" 
                    className="cancel-btn" 
                    onClick={clearSelection}
                    aria-label="Remove image"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </label>
          </div>

          <button 
            className={`btn-primary ${isLoading ? "loading" : ""}`}
            onClick={handleRemoveBg} 
            disabled={(!selectedFile && !selectedImageUrl) || isLoading}
          >
            {isLoading ? "Processing" : "Remove Background"}
          </button>
        </section>

        {(previewUrl || (fetcher.data && "success" in fetcher.data)) && (
          <section className="results-section">
            <h2 className="results-title">
              Results
            </h2>
            
            <div className="results-grid">
              {previewUrl && (
                <div className="result-card glass-inner">
                  <h3>Original Image</h3>
                  <div className={`image-preview-container ${isLoading ? "processing" : ""}`}>
                     <img src={previewUrl} alt="Original upload" />
                  </div>
                </div>
              )}
              
              {fetcher.data && "success" in fetcher.data && (
                <div className="result-card glass-inner">
                  <h3>
                    Processed Image
                    <span className="success-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Success
                    </span>
                  </h3>
                  <div className="image-preview-container transparent-bg" style={{ padding: "0" }}>
                     <img
                       src={`data:image/png;base64,${(fetcher.data as { processedImageBase64?: string }).processedImageBase64}`}
                       alt="Result without background"
                       style={{ background: "transparent" }}
                     />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
