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
        log.info(`get_image_metadata called with uuid: ${args.uuid}`);
        const response = await makeApiCall(`/api/image/${args.uuid}`);
        const responseText = await response.text();
        log.debug(`Response body (raw): ${responseText.substring(0, 500)}`);

        if (!response.ok) {
          // Try to parse error response as JSON for better error messages
          let errorMessage = responseText;
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            try {
              const errorData = JSON.parse(responseText);
              log.error(
                `Failed to get image metadata: ${response.status}`,
                errorData
              );
              errorMessage =
                typeof errorData === "object" &&
                errorData !== null &&
                "error" in errorData
                  ? JSON.stringify(errorData, null, 2)
                  : responseText;
            } catch (parseError) {
              log.error(
                `Failed to parse JSON error response: ${parseError}`,
                responseText.substring(0, 500)
              );
            }
          } else if (contentType.includes("text/html")) {
            // Extract error message from HTML if possible
            const errorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
            if (errorMatch) {
              const htmlError = errorMatch[1]
                .replace(/<br\s*\/?>/g, "\n")
                .replace(/&nbsp;/g, " ")
                .replace(/&#39;/g, "'")
                .trim();
              log.error(
                `Failed to get image metadata: ${response.status} (HTML response)`,
                htmlError
              );
              errorMessage = `Server error: ${htmlError}`;
            } else {
              log.error(
                `Failed to get image metadata: ${response.status} (HTML response)`,
                responseText.substring(0, 500)
              );
              errorMessage = `Server returned HTML error page (${response.status})`;
            }
          } else {
            log.error(
              `Failed to get image metadata: ${response.status}`,
              responseText.substring(0, 500)
            );
          }
          throw new Error(
            `Failed to get image metadata: ${response.status} ${errorMessage}`
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(responseText);
          log.debug(`Parsed response data:`, data);
        } catch (parseError) {
          log.error(`Failed to parse JSON response: ${parseError}`);
          log.error(`Response text was: ${responseText}`);
          throw new Error(
            `Invalid JSON response: ${responseText.substring(0, 200)}`
          );
        }

        // Format the response in a more readable way for LLMs
        if (typeof data === "object" && data !== null) {
          const metadata = data as Record<string, unknown>;
          let formattedText = "## Image Metadata\n\n";

          // Extract and format key fields
          if (metadata.id) {
            formattedText += `**Image ID:** ${metadata.id}\n\n`;
          }

          if (metadata.category) {
            formattedText += `**Category:** ${metadata.category}\n\n`;
          }

          if (metadata.downloadedS3Path) {
            formattedText += `**S3 Path:** ${metadata.downloadedS3Path}\n\n`;
          }

          if (metadata.originalFileUrl) {
            formattedText += `**Original Image URL:** ${metadata.originalFileUrl}\n\n`;
            formattedText += `> This is a signed URL that can be used to access the original image. The URL includes authentication parameters and may expire.\n\n`;
          }

          // Add any additional fields
          const additionalFields: string[] = [];
          for (const [key, value] of Object.entries(metadata)) {
            if (
              ![
                "id",
                "category",
                "downloadedS3Path",
                "originalFileUrl",
              ].includes(key)
            ) {
              additionalFields.push(`- **${key}:** ${JSON.stringify(value)}`);
            }
          }

          if (additionalFields.length > 0) {
            formattedText += "**Additional Information:**\n";
            formattedText += additionalFields.join("\n") + "\n\n";
          }

          // Add raw JSON for reference
          formattedText += "---\n\n**Raw JSON Response:**\n```json\n";
          formattedText += JSON.stringify(data, null, 2);
          formattedText += "\n```";

          return {
            content: [
              {
                type: "text",
                text: formattedText,
              },
            ],
          };
        }

        // Fallback to JSON if data structure is unexpected
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
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

  // Register list_categories tool
  server.registerTool(
    "list_categories",
    {
      description:
        "Lists all available image categories and their supported sizes. This helps determine what categories can be used when uploading images and what size options are available.",
      inputSchema: z.object({}),
    },
    async (args) => {
      try {
        log.info(`list_categories called`);
        const response = await makeApiCall(`/api/category/list`);
        const responseText = await response.text();
        log.debug(`Response body (raw): ${responseText.substring(0, 500)}`);

        if (!response.ok) {
          // Try to parse error response as JSON for better error messages
          let errorMessage = responseText;
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            try {
              const errorData = JSON.parse(responseText);
              log.error(
                `Failed to list categories: ${response.status}`,
                errorData
              );
              errorMessage =
                typeof errorData === "object" &&
                errorData !== null &&
                "error" in errorData
                  ? JSON.stringify(errorData, null, 2)
                  : responseText;
            } catch (parseError) {
              log.error(
                `Failed to parse JSON error response: ${parseError}`,
                responseText.substring(0, 500)
              );
            }
          } else if (contentType.includes("text/html")) {
            // Extract error message from HTML if possible
            const errorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
            if (errorMatch) {
              const htmlError = errorMatch[1]
                .replace(/<br\s*\/?>/g, "\n")
                .replace(/&nbsp;/g, " ")
                .replace(/&#39;/g, "'")
                .trim();
              log.error(
                `Failed to list categories: ${response.status} (HTML response)`,
                htmlError
              );
              errorMessage = `Server error: ${htmlError}`;
            } else {
              log.error(
                `Failed to list categories: ${response.status} (HTML response)`,
                responseText.substring(0, 500)
              );
              errorMessage = `Server returned HTML error page (${response.status})`;
            }
          } else {
            log.error(
              `Failed to list categories: ${response.status}`,
              responseText.substring(0, 500)
            );
          }
          throw new Error(
            `Failed to list categories: ${response.status} ${errorMessage}`
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(responseText);
          log.debug(`Parsed response data:`, data);
        } catch (parseError) {
          log.error(`Failed to parse JSON response: ${parseError}`);
          log.error(`Response text was: ${responseText}`);
          throw new Error(
            `Invalid JSON response: ${responseText.substring(0, 200)}`
          );
        }

        // Format the response in a more readable way for LLMs
        if (Array.isArray(data)) {
          let formattedText = "## Available Image Categories\n\n";

          if (data.length === 0) {
            formattedText += "No categories are currently available.\n\n";
          } else {
            formattedText += `Found ${data.length} categor${
              data.length === 1 ? "y" : "ies"
            }:\n\n`;

            for (const category of data) {
              if (typeof category === "object" && category !== null) {
                const cat = category as Record<string, unknown>;
                const name = cat.name || "Unknown";
                formattedText += `### ${name}\n\n`;

                if (Array.isArray(cat.sizes) && cat.sizes.length > 0) {
                  formattedText += `**Available Sizes:**\n\n`;

                  for (const size of cat.sizes) {
                    if (typeof size === "object" && size !== null) {
                      const sizeObj = size as Record<string, unknown>;
                      const sizeName = sizeObj.name || "Unknown";
                      const width = sizeObj.width || "?";
                      const height = sizeObj.height || "?";
                      const mimeType = sizeObj.mimeType || "Unknown";

                      formattedText += `- **${sizeName}**: ${width}×${height} pixels (${mimeType})\n`;
                    }
                  }
                  formattedText += "\n";
                } else {
                  formattedText += "No sizes configured for this category.\n\n";
                }
              }
            }
          }

          // Add raw JSON for reference
          formattedText += "---\n\n**Raw JSON Response:**\n```json\n";
          formattedText += JSON.stringify(data, null, 2);
          formattedText += "\n```";

          return {
            content: [
              {
                type: "text",
                text: formattedText,
              },
            ],
          };
        }

        // Fallback to JSON if data structure is unexpected
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
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
        log.info(
          `get_resized_image called with uuid: ${args.uuid}, size: ${args.size}`
        );
        const response = await makeApiCall(
          `/api/image/s/${args.uuid}/${args.size}`
        );
        const responseText = await response.text();
        log.debug(`Response body (raw): ${responseText.substring(0, 500)}`);

        if (!response.ok) {
          // Try to parse error response as JSON for better error messages
          let errorMessage = responseText;
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            try {
              const errorData = JSON.parse(responseText);
              log.error(
                `Failed to get resized image URL: ${response.status}`,
                errorData
              );
              errorMessage =
                typeof errorData === "object" &&
                errorData !== null &&
                "error" in errorData
                  ? JSON.stringify(errorData, null, 2)
                  : responseText;
            } catch (parseError) {
              log.error(
                `Failed to parse JSON error response: ${parseError}`,
                responseText.substring(0, 500)
              );
            }
          } else if (contentType.includes("text/html")) {
            // Extract error message from HTML if possible
            const errorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
            if (errorMatch) {
              const htmlError = errorMatch[1]
                .replace(/<br\s*\/?>/g, "\n")
                .replace(/&nbsp;/g, " ")
                .replace(/&#39;/g, "'")
                .trim();
              log.error(
                `Failed to get resized image URL: ${response.status} (HTML response)`,
                htmlError
              );
              errorMessage = `Server error: ${htmlError}`;
            } else {
              log.error(
                `Failed to get resized image URL: ${response.status} (HTML response)`,
                responseText.substring(0, 500)
              );
              errorMessage = `Server returned HTML error page (${response.status})`;
            }
          } else {
            log.error(
              `Failed to get resized image URL: ${response.status}`,
              responseText.substring(0, 500)
            );
          }
          throw new Error(
            `Failed to get resized image URL: ${response.status} ${errorMessage}`
          );
        }

        let data: { url?: string } | unknown;
        try {
          data = JSON.parse(responseText);
          log.debug(`Parsed response data:`, data);
        } catch (parseError) {
          log.error(`Failed to parse JSON response: ${parseError}`);
          log.error(`Response text was: ${responseText}`);
          throw new Error(
            `Invalid JSON response: ${responseText.substring(0, 200)}`
          );
        }

        // Format the response in a more readable way for LLMs
        if (typeof data === "object" && data !== null) {
          const responseData = data as Record<string, unknown>;
          const url =
            "url" in responseData && typeof responseData.url === "string"
              ? responseData.url
              : null;

          log.info(`Extracted URL: ${url || "null"}`);

          if (url) {
            let formattedText = "## Resized Image URL\n\n";
            formattedText += `**Image UUID:** ${args.uuid}\n\n`;
            formattedText += `**Requested Size:** ${args.size}\n\n`;
            formattedText += `**Download URL:** ${url}\n\n`;
            formattedText += `> This is a signed URL that can be used to download the image at the requested size. The URL includes authentication parameters and may expire.\n\n`;

            // Add any additional fields from the response
            const additionalFields: string[] = [];
            for (const [key, value] of Object.entries(responseData)) {
              if (key !== "url") {
                additionalFields.push(`- **${key}:** ${JSON.stringify(value)}`);
              }
            }

            if (additionalFields.length > 0) {
              formattedText += "**Additional Information:**\n";
              formattedText += additionalFields.join("\n") + "\n\n";
            }

            // Add raw JSON for reference
            formattedText += "---\n\n**Raw JSON Response:**\n```json\n";
            formattedText += JSON.stringify(data, null, 2);
            formattedText += "\n```";

            return {
              content: [
                {
                  type: "text",
                  text: formattedText,
                },
              ],
            };
          } else {
            // URL not found in response, return formatted error message
            return {
              content: [
                {
                  type: "text",
                  text: `## Resized Image URL\n\n**Warning:** No URL found in the response.\n\n**Image UUID:** ${
                    args.uuid
                  }\n**Requested Size:** ${
                    args.size
                  }\n\n**Response Data:**\n\`\`\`json\n${JSON.stringify(
                    data,
                    null,
                    2
                  )}\n\`\`\``,
                },
              ],
            };
          }
        }

        // Fallback to JSON if data structure is unexpected
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
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

        // Read the file
        const fileBuffer = await readFile(args.filename);
        const fileName = args.filename.split("/").pop() || "image";
        log.debug(`Read file: ${fileName}, size: ${fileBuffer.length} bytes`);

        // Create FormData for multipart upload
        const formData = new FormData();
        const blob = new Blob([fileBuffer], {
          type: "application/octet-stream",
        });
        formData.append("image", blob, fileName);
        log.debug(`Created FormData with file: ${fileName}`);

        // Make the API call with forceImmediateResize=true
        const response = await makeApiCall(
          `/api/image/${args.category}?forceImmediateResize=true`,
          {
            method: "POST",
            body: formData,
          }
        );

        const responseText = await response.text();
        log.debug(`Response body (raw): ${responseText.substring(0, 500)}`);

        if (!response.ok) {
          // Try to parse error response as JSON for better error messages
          let errorMessage = responseText;
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            try {
              const errorData = JSON.parse(responseText);
              log.error(
                `Failed to upload image: ${response.status}`,
                errorData
              );
              errorMessage =
                typeof errorData === "object" &&
                errorData !== null &&
                "error" in errorData
                  ? JSON.stringify(errorData, null, 2)
                  : responseText;
            } catch (parseError) {
              log.error(
                `Failed to parse JSON error response: ${parseError}`,
                responseText.substring(0, 500)
              );
            }
          } else if (contentType.includes("text/html")) {
            // Extract error message from HTML if possible
            const errorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
            if (errorMatch) {
              const htmlError = errorMatch[1]
                .replace(/<br\s*\/?>/g, "\n")
                .replace(/&nbsp;/g, " ")
                .replace(/&#39;/g, "'")
                .trim();
              log.error(
                `Failed to upload image: ${response.status} (HTML response)`,
                htmlError
              );
              errorMessage = `Server error: ${htmlError}`;
            } else {
              log.error(
                `Failed to upload image: ${response.status} (HTML response)`,
                responseText.substring(0, 500)
              );
              errorMessage = `Server returned HTML error page (${response.status})`;
            }
          } else {
            log.error(
              `Failed to upload image: ${response.status}`,
              responseText.substring(0, 500)
            );
          }
          throw new Error(
            `Failed to upload image: ${response.status} ${errorMessage}`
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(responseText);
          log.debug(`Parsed response data:`, data);
        } catch (parseError) {
          log.error(`Failed to parse JSON response: ${parseError}`);
          log.error(`Response text was: ${responseText}`);
          throw new Error(
            `Invalid JSON response: ${responseText.substring(0, 200)}`
          );
        }

        log.info(`Successfully uploaded image, response:`, data);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
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

        // Read the file
        const fileBuffer = await readFile(args.filename);
        const fileName = args.filename.split("/").pop() || "image";
        log.debug(`Read file: ${fileName}, size: ${fileBuffer.length} bytes`);

        // Create FormData for multipart upload
        const formData = new FormData();
        const blob = new Blob([fileBuffer], {
          type: "application/octet-stream",
        });
        formData.append("image", blob, fileName);
        log.debug(`Created FormData with file: ${fileName}`);

        // Make the API call with forceImmediateResize=false
        const response = await makeApiCall(
          `/api/image/${args.category}?forceImmediateResize=false`,
          {
            method: "POST",
            body: formData,
          }
        );

        const responseText = await response.text();
        log.debug(`Response body (raw): ${responseText.substring(0, 500)}`);

        if (!response.ok) {
          // Try to parse error response as JSON for better error messages
          let errorMessage = responseText;
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            try {
              const errorData = JSON.parse(responseText);
              log.error(
                `Failed to upload image: ${response.status}`,
                errorData
              );
              errorMessage =
                typeof errorData === "object" &&
                errorData !== null &&
                "error" in errorData
                  ? JSON.stringify(errorData, null, 2)
                  : responseText;
            } catch (parseError) {
              log.error(
                `Failed to parse JSON error response: ${parseError}`,
                responseText.substring(0, 500)
              );
            }
          } else if (contentType.includes("text/html")) {
            // Extract error message from HTML if possible
            const errorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
            if (errorMatch) {
              const htmlError = errorMatch[1]
                .replace(/<br\s*\/?>/g, "\n")
                .replace(/&nbsp;/g, " ")
                .replace(/&#39;/g, "'")
                .trim();
              log.error(
                `Failed to upload image: ${response.status} (HTML response)`,
                htmlError
              );
              errorMessage = `Server error: ${htmlError}`;
            } else {
              log.error(
                `Failed to upload image: ${response.status} (HTML response)`,
                responseText.substring(0, 500)
              );
              errorMessage = `Server returned HTML error page (${response.status})`;
            }
          } else {
            log.error(
              `Failed to upload image: ${response.status}`,
              responseText.substring(0, 500)
            );
          }
          throw new Error(
            `Failed to upload image: ${response.status} ${errorMessage}`
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(responseText);
          log.debug(`Parsed response data:`, data);
        } catch (parseError) {
          log.error(`Failed to parse JSON response: ${parseError}`);
          log.error(`Response text was: ${responseText}`);
          throw new Error(
            `Invalid JSON response: ${responseText.substring(0, 200)}`
          );
        }

        log.info(`Successfully uploaded image, response:`, data);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
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
