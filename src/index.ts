#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config, logging } from "@hikari-systems/hs.utils";
import { readFile } from "node:fs/promises";

const log = logging("main");
const { configString } = config;

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
    return fetch(url, { ...options, headers });
  };

  // Register get_image_metadata tool
  server.registerTool(
    "get_image_metadata",
    {
      description: "Gets metadata for an image by its UUID",
      inputSchema: z.object({
        uuid: z.string().describe("The image service UUID"),
      }),
    },
    async (args) => {
      try {
        const response = await makeApiCall(`/api/image/${args.uuid}`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to get image metadata: ${response.status} ${errorText}`
          );
        }
        const data = (await response.json()) as unknown;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
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
        uuid: z.string().describe("The image service UUID"),
        size: z
          .string()
          .describe(
            "The preferred size (e.g., 'thumbnail', 'small', 'medium', 'large')"
          ),
      }),
    },
    async (args) => {
      try {
        const response = await makeApiCall(
          `/api/image/s/${args.uuid}/${args.size}`
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to get resized image URL: ${response.status} ${errorText}`
          );
        }
        const data = (await response.json()) as { url?: string } | unknown;
        const url =
          typeof data === "object" && data !== null && "url" in data
            ? (data as { url: string }).url
            : null;
        return {
          content: [
            {
              type: "text",
              text: url || JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
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
        // Read the file
        const fileBuffer = await readFile(args.filename);
        const fileName = args.filename.split("/").pop() || "image";

        // Create FormData for multipart upload
        const formData = new FormData();
        const blob = new Blob([fileBuffer], {
          type: "application/octet-stream",
        });
        formData.append("image", blob, fileName);

        // Make the API call with forceImmediateResize=true
        const response = await makeApiCall(
          `/api/image/${args.category}?forceImmediateResize=true`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to upload image: ${response.status} ${errorText}`
          );
        }

        const data = (await response.json()) as unknown;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
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
        // Read the file
        const fileBuffer = await readFile(args.filename);
        const fileName = args.filename.split("/").pop() || "image";

        // Create FormData for multipart upload
        const formData = new FormData();
        const blob = new Blob([fileBuffer], {
          type: "application/octet-stream",
        });
        formData.append("image", blob, fileName);

        // Make the API call with forceImmediateResize=false
        const response = await makeApiCall(
          `/api/image/${args.category}?forceImmediateResize=false`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to upload image: ${response.status} ${errorText}`
          );
        }

        const data = (await response.json()) as unknown;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
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
