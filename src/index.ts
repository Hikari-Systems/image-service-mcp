#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "@hikari-systems/hs.utils";
import { readFile } from "node:fs/promises";

// Create a logger that writes to stderr instead of stdout
// MCP servers must only output JSON-RPC messages to stdout
const log = {
  info: (...args: unknown[]) => {
    console.error(`[INFO]`, ...args);
  },
  error: (...args: unknown[]) => {
    console.error(`[ERROR]`, ...args);
  },
  debug: (...args: unknown[]) => {
    console.error(`[DEBUG]`, ...args);
  },
  warn: (...args: unknown[]) => {
    console.error(`[WARN]`, ...args);
  },
};
const { configString } = config;

// Interface definitions for API responses
interface ResizedFile {
  size: string;
  s3Path: string;
}

interface ImageMetadata {
  id: string;
  category: string;
  downloadedS3Path?: string;
  originalS3Path?: string;
  resizedFiles?: ResizedFile[];
}

interface CategorySize {
  name: string;
  width: number;
  height: number;
  mimeType: string;
}

interface Category {
  name: string;
  sizes: CategorySize[];
}

/**
 * Image Service MCP Server
 * A simple MCP server that demonstrates basic functionality
 */
async function main() {
  // Get configuration values
  const baseUrl = configString("image-service:url", process.argv?.[2] || "");
  const apiKey = configString("image-service:apiKey", process.argv?.[3] || "");

  if (baseUrl.trim() === "") {
    log.error(
      "Usage: npx @hikari-systems/image-service-mcp <image-service-url> <image-service-api-key>"
    );
    process.exit(1);
  }

  // Create a new server instance
  const server = new McpServer(
    {
      name: "image-service-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Helper function to make API calls
  const makeApiCall = async (
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const url = `${baseUrl}${endpoint}`;
    const headers = {
      "X-API-Key": apiKey,
      ...options.headers,
    };
    log.info(`Making API call: ${options.method || "GET"} ${url}`);
    log.debug(`Request headers:`, { ...headers, "X-API-Key": "***" });
    const response = await fetch(url, { ...options, headers });
    log.info(`API response status: ${response.status} ${response.statusText}`);
    log.debug(
      `Response headers:`,
      Object.fromEntries(response.headers.entries())
    );
    return response;
  };

  // Fetch and cache categories on startup
  const getCategories = async (): Promise<Category[] | null> => {
    try {
      log.info("Loading size cache on startup...");
      const response = await makeApiCall(`/api/size/list`);
      if (!response.ok) {
        log.warn(
          `Failed to load size cache: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const categories = (await response.json()) as Category[];
      const localSizeCache: Record<string, CategorySize> = {};

      for (const category of categories) {
        if (category && category.name && Array.isArray(category.sizes)) {
          for (const size of category.sizes) {
            localSizeCache[size.name] = size;
          }
        }
      }
      log.info(
        `Size cache loaded: ${Object.keys(localSizeCache).length} sizes`
      );
      sizeCache = localSizeCache;
      lastUpdatedAt = Date.now();
      return categories;
    } catch (error) {
      log.warn(`Error loading size cache: ${error}`);
      return null;
    }
  };

  // Cache for categories (loaded on startup)
  let sizeCache: Record<string, CategorySize> | undefined;
  let lastUpdatedAt: number | undefined;
  let lastAccessedAt: number | undefined;

  // Internal method to get size cache with automatic refresh
  const getSizeCache = async (): Promise<
    Record<string, CategorySize> | undefined
  > => {
    const fiveMinutesInMs = 5 * 60 * 1000;
    const now = Date.now();

    // Check if cache is falsey or was last accessed more than 5 mins ago
    if (
      !sizeCache ||
      !lastAccessedAt ||
      now - lastAccessedAt > fiveMinutesInMs
    ) {
      log.info("Size cache is stale or missing, reloading...");
      await getCategories();
    }

    lastAccessedAt = Date.now();
    return sizeCache;
  };

  const buildImageMetadataResponseText = async (
    metadata: ImageMetadata,
    label: string
  ): Promise<string> => {
    // Format the response in a more readable way for LLMs
    let formattedText = `## ${label}\n\n`;

    formattedText += `**Image ID:** ${metadata.id}\n\n`;
    formattedText += `**Category:** ${metadata.category}\n\n`;

    // Get available sizes using resizedFiles from metadata and size cache
    if (metadata.resizedFiles && metadata.resizedFiles.length > 0) {
      formattedText += `**Available Sizes:**\n\n`;

      // Match resizedFiles with cached size dimensions
      const cache = await getSizeCache();
      for (const resizedFile of metadata.resizedFiles) {
        const sizeInfo = cache?.[resizedFile.size];
        if (sizeInfo) {
          formattedText += `- **${resizedFile.size}**: ${sizeInfo.width}×${sizeInfo.height} pixels\n`;
        } else {
          // Size not found in cache, show without dimensions
          formattedText += `- **${resizedFile.size}**\n`;
        }
      }
      formattedText += "\n";
    } else {
      formattedText += `*Note: No resized files available for this image.*\n\n`;
    }

    return formattedText;
  };

  // Register get_image_metadata tool
  server.registerTool(
    "get_image_metadata",
    {
      description: "Gets metadata for an image by its UUID",
      inputSchema: z.object({
        imageServiceId: z.string().describe("The image service ID"),
      }),
    },
    async (args: { imageServiceId: string }) => {
      try {
        log.info(`get_image_metadata called with uuid: ${args.imageServiceId}`);
        const response = await makeApiCall(`/api/image/${args.imageServiceId}`);

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `Failed to get image metadata: ${response.status} ${responseText}`
          );
        }

        const metadata = (await response.json()) as ImageMetadata;
        const formattedText = await buildImageMetadataResponseText(
          metadata,
          "Image Metadata"
        );

        return {
          content: [
            {
              type: "text",
              text: formattedText,
            },
          ],
        };
      } catch (error) {
        log.error(`Error in get_image_metadata:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register transcode_image tool
  server.registerTool(
    "transcode_image",
    {
      description:
        "Transcodes an image by its UUID. This triggers the transcoding process and returns the updated image metadata.",
      inputSchema: z.object({
        imageServiceId: z.string().describe("The image service ID"),
      }),
    },
    async (args: { imageServiceId: string }) => {
      try {
        log.info(`transcode_image called with uuid: ${args.imageServiceId}`);
        const response = await makeApiCall(
          `/api/image/${args.imageServiceId}/transcode`,
          {
            method: "POST",
          }
        );

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `Failed to transcode image: ${response.status} ${responseText}`
          );
        }

        const metadata = (await response.json()) as ImageMetadata;

        // Format the response in a more readable way for LLMs
        let formattedText = "## Image Transcode Result\n\n";

        formattedText += `**Image ID:** ${metadata.id}\n\n`;
        formattedText += `**Category:** ${metadata.category}\n\n`;

        // Get available sizes using resizedFiles from metadata and size cache
        if (metadata.resizedFiles && metadata.resizedFiles.length > 0) {
          formattedText += `**Available Sizes:**\n\n`;

          // Match resizedFiles with cached size dimensions
          const cache = await getSizeCache();
          for (const resizedFile of metadata.resizedFiles) {
            const sizeInfo = cache?.[resizedFile.size];
            if (sizeInfo) {
              formattedText += `- **${resizedFile.size}**: ${sizeInfo.width}×${sizeInfo.height} pixels\n`;
            } else {
              // Size not found in cache, show without dimensions
              formattedText += `- **${resizedFile.size}**\n`;
            }
          }
          formattedText += "\n";
        } else {
          formattedText += `*Note: No resized files available for this image.*\n\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: formattedText,
            },
          ],
        };
      } catch (error) {
        log.error(`Error in transcode_image:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register list_categories tool
  server.registerTool(
    "list_categories",
    {
      description:
        "Lists all available image categories and their supported sizes. This helps determine what categories can be used when uploading images and what size options are available.",
      inputSchema: z.object({}),
    },
    async (): Promise<any> => {
      try {
        log.info(`list_categories called`);
        const categories: Category[] | null = await getCategories();
        if (categories === null) {
          return {
            content: [
              {
                type: "text",
                text: "No categories are currently available.",
              },
            ],
          };
        }
        let formattedText = `Found ${categories.length} categor${
          categories.length === 1 ? "y" : "ies"
        }:\n\n`;

        for (const category of categories) {
          if (category !== null) {
            formattedText += `### ${category.name || "Unknown"}\n\n`;

            if (category.sizes.length > 0) {
              formattedText += `**Available Sizes:**\n\n`;

              for (const size of category.sizes) {
                formattedText += `- **${size.name || "Unknown"}**: ${
                  size.width || "?"
                }×${size.height || "?"} pixels (${
                  size.mimeType || "Unknown"
                })\n`;
              }
              formattedText += "\n";
            } else {
              formattedText += "No sizes configured for this category.\n\n";
            }
          }

          return {
            content: [
              {
                type: "text",
                text: formattedText,
              },
            ],
          };
        }
      } catch (error) {
        log.error(`Error in list_categories:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register get_resized_image tool
  server.registerTool(
    "get_resized_image",
    {
      description:
        "Gets a URL for downloading an image at a specific size. Returns a URL from which the image can be downloaded.",
      inputSchema: z.object({
        imageServiceId: z.string().describe("The image service ID"),
        size: z
          .string()
          .describe(
            "The preferred size (e.g., 'thumbnail', 'small', 'medium', 'large')"
          ),
      }),
    },
    async (args: { imageServiceId: string; size: string }) => {
      try {
        log.info(
          `get_resized_image called with imageServiceId: ${args.imageServiceId}, size: ${args.size}`
        );
        const response = await makeApiCall(
          `/api/image/s/${args.imageServiceId}/${args.size}`
        );

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `Failed to get resized image URL: ${response.status} ${responseText}`
          );
        }

        const parsedResponse = (await response.json()) as { url?: string };

        // Format the response in a more readable way for LLMs
        if (parsedResponse && parsedResponse.url) {
          log.info(`Extracted URL: ${parsedResponse.url || "null"}`);

          if (parsedResponse.url) {
            let formattedText = "## Resized Image URL\n\n";
            formattedText += `**Image UUID:** ${args.imageServiceId}\n\n`;
            formattedText += `**Requested Size:** ${args.size}\n\n`;
            formattedText += `**Download URL:** ${parsedResponse.url}\n\n`;
            formattedText += `> This is a signed URL that can be used to download the image at the requested size. The URL includes authentication parameters and may expire.\n\n`;

            return {
              content: [
                {
                  type: "text",
                  text: formattedText,
                },
              ],
            };
          }
          // URL not found in response, return formatted error message
          return {
            content: [
              {
                type: "text",
                text: `## Resized Image URL\n\n**Warning:** No URL found in the response.\n\n**Image UUID:** ${
                  args.imageServiceId
                }\n**Requested Size:** ${
                  args.size
                }\n\n**Response Data:**\n\`\`\`json\n${JSON.stringify(
                  parsedResponse,
                  null,
                  2
                )}\n\`\`\``,
              },
            ],
          };
        }

        // Fallback to JSON if data structure is unexpected
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(parsedResponse, null, 2),
            },
          ],
        };
      } catch (error) {
        log.error(`Error in get_resized_image:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Common function for uploading images
  const uploadImage = async (
    category: string,
    filename: string,
    resize: boolean
  ): Promise<ImageMetadata> => {
    // Read the file
    const fileBuffer = await readFile(filename);
    const fileName = filename.split("/").pop() || "image";
    log.debug(`Read file: ${fileName}, size: ${fileBuffer.length} bytes`);

    // Create FormData for multipart upload
    const formData = new FormData();
    const blob = new Blob([fileBuffer], {
      type: "application/octet-stream",
    });
    formData.append("image", blob, fileName);
    log.debug(`Created FormData with file: ${fileName}`);

    // Make the API call
    const response = await makeApiCall(
      `/api/image/${category}?forceImmediateResize=${resize}`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Failed to upload image: ${response.status} ${responseText}`
      );
    }

    const imageMetadata = (await response.json()) as ImageMetadata;

    if (!imageMetadata.id || !imageMetadata.category) {
      throw new Error(
        `Invalid response format: missing required fields. Response: ${JSON.stringify(
          imageMetadata
        )}`
      );
    }

    log.info(`Successfully uploaded image, response:`, imageMetadata);
    return imageMetadata;
  };

  // Register upload_and_resize_image tool (with forceImmediateResize=true)
  server.registerTool(
    "upload_and_resize_image",
    {
      description:
        "Uploads an image file and immediately resizes it. Takes an image category and a local filename, reads the file, and uploads it to the image service with forceImmediateResize set to true.",
      inputSchema: z.object({
        category: z.string().describe("The image category"),
        filename: z.string().describe("The local file path to upload"),
      }),
    },
    async (args) => {
      try {
        log.info(
          `upload_and_resize_image called with category: ${args.category}, filename: ${args.filename}`
        );

        const metadata = await uploadImage(args.category, args.filename, true);

        return {
          content: [
            {
              type: "text",
              text: await buildImageMetadataResponseText(
                metadata,
                "Image uploaded and resized"
              ),
            },
          ],
        };
      } catch (error) {
        log.error(`Error in upload_and_resize_image:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register upload_image tool (with forceImmediateResize=false)
  server.registerTool(
    "upload_image",
    {
      description:
        "Uploads an image file without immediate resizing. Takes an image category and a local filename, reads the file, and uploads it to the image service with forceImmediateResize set to false.",
      inputSchema: z.object({
        category: z.string().describe("The image category"),
        filename: z.string().describe("The local file path to upload"),
      }),
    },
    async (args) => {
      try {
        log.info(
          `upload_image called with category: ${args.category}, filename: ${args.filename}`
        );

        const metadata = await uploadImage(args.category, args.filename, false);

        return {
          content: [
            {
              type: "text",
              text: await buildImageMetadataResponseText(
                metadata,
                "Image uploaded"
              ),
            },
          ],
        };
      } catch (error) {
        log.error(`Error in upload_image:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("Image Service MCP server running on stdio");
  log.info(`Base URL: ${baseUrl}`);
  log.info(`API Key: ${apiKey.substring(0, 8)}...`);
}

main().catch((error) => {
  log.error("Fatal error", error);
  process.exit(1);
});
