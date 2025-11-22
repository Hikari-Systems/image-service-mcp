# Image Service MCP Server

A Model Context Protocol (MCP) server that provides tools for interacting with an image service API. This server enables AI assistants (like Cursor) to upload images, retrieve image metadata, and get resized image URLs through a standardized MCP interface.

## Features

This MCP server provides the following tools:

- **`list_categories`**: List all available image categories and their supported sizes (helps determine valid categories and size options)
- **`get_image_metadata`**: Retrieve metadata for an image by its UUID (returns formatted markdown for easy LLM parsing)
- **`get_resized_image`**: Get a download URL for an image at a specific size (thumbnail, small, medium, large) with formatted output
- **`upload_image`**: Upload an image file without immediate resizing
- **`upload_and_resize_image`**: Upload an image file and immediately resize it

All tools include comprehensive logging and error handling to help debug API interactions.

## Installation

```bash
npm install
```

## Development

```bash
# Build the project
npm run build

# Run in development mode
npm run dev

# Run the built server
npm start
```

## Usage with npx

After building and publishing to npm, you can run the server with:

```bash
npx @hikari-systems/image-service-mcp <image-service-url> <image-service-api-key>
```

**Example:**

```bash
npx @hikari-systems/image-service-mcp http://localhost:3001 sdflkjghwiuryt32452345
```

### Command-Line Arguments

- `<image-service-url>` (required): The base URL for the image service API (e.g., `http://localhost:3001`)
- `<image-service-api-key>` (required): The API key for authenticating with the image service

## Adding to Cursor

To use this MCP server with Cursor, you need to add it to your Cursor settings. Here's how:

### Step 1: Open Cursor Settings

1. Open Cursor
2. Go to **Settings** (or press `Cmd/Ctrl + ,`)
3. Navigate to **Features** → **Model Context Protocol** → **Servers**

### Step 2: Add the Server Configuration

Add the following configuration to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "image-service": {
      "command": "npx",
      "args": [
        "@hikari-systems/image-service-mcp",
        "http://localhost:3001",
        "your-api-key-here"
      ]
    }
  }
}
```

**Note:** Replace `http://localhost:3001` with your actual image service URL and `your-api-key-here` with your actual API key.

### Alternative: Using Environment Variables

If you prefer to keep sensitive information out of your settings file, you can use environment variables:

```json
{
  "mcpServers": {
    "image-service": {
      "command": "npx",
      "args": ["@hikari-systems/image-service-mcp"],
      "env": {
        "image-service__url": "http://localhost:3001",
        "image-service__apiKey": "your-api-key-here"
      }
    }
  }
}
```

### Step 3: Restart Cursor

After adding the configuration, restart Cursor to load the MCP server.

### Step 4: Verify Installation

Once Cursor restarts, the image service tools should be available. You can verify by asking Cursor to use one of the tools, for example:

- "Get metadata for image UUID abc123"
- "Upload this image file: /path/to/image.jpg"
- "Get a thumbnail URL for image UUID xyz789"

## Local Development with npx

To test locally with npx before publishing:

```bash
# Build the project
npm run build

# Link the package locally
npm link

# Run with npx (using the scoped package name)
npx @hikari-systems/image-service-mcp http://localhost:3001 your-api-key
```

## Publishing

To publish this scoped package to npm:

```bash
# Make sure you're logged in to npm
npm login

# Publish with public access (required for scoped packages by default)
npm publish --access public
```

## MCP Tools

### list_categories

Lists all available image categories and their supported sizes. This tool helps determine what categories can be used when uploading images and what size options are available for resizing.

**Parameters:**

- None (no parameters required)

**Example:**

```json
{
  "name": "list_categories",
  "arguments": {}
}
```

**Response Format:**

The tool returns a formatted markdown response that includes:

- **Category List**: All available categories with their names
- **Available Sizes**: For each category, lists all supported sizes with:
  - Size name (e.g., "small", "medium", "large")
  - Dimensions (width × height in pixels)
  - MIME type
- **Raw JSON Response**: The complete JSON response for reference

**Example Response:**

```
## Available Image Categories

Found 1 category:

### default

**Available Sizes:**

- **small**: 100×100 pixels (image/jpg)
- **medium**: 200×200 pixels (image/jpg)
- **large**: 400×400 pixels (image/png)

---

**Raw JSON Response:**
The complete JSON response is also included at the end for programmatic access.
```

### get_image_metadata

Retrieves metadata for an image by its UUID. Returns a formatted markdown response with key information clearly presented, making it easy for LLMs to parse and understand.

**Parameters:**

- `uuid` (required): The image service UUID

**Example:**

```json
{
  "name": "get_image_metadata",
  "arguments": {
    "uuid": "abc123-def456-ghi789"
  }
}
```

**Response Format:**

The tool returns a formatted markdown response that includes:

- **Image ID**: The unique identifier for the image
- **Category**: The image category
- **S3 Path**: The S3 storage path for the image
- **Original Image URL**: A signed URL to access the original image (with expiration notice)
- **Additional Information**: Any other fields returned by the API
- **Raw JSON Response**: The complete JSON response for reference

**Example Response:**

```
## Image Metadata

**Image ID:** abc123-def456-ghi789

**Category:** products

**S3 Path:** products-abc123-def456-ghi789.png

**Original Image URL:** https://images.preview.hikari-systems.com/...

> This is a signed URL that can be used to access the original image. The URL includes authentication parameters and may expire.

---

**Raw JSON Response:**
The complete JSON response is also included at the end for programmatic access.
```

### get_resized_image

Gets a URL for downloading an image at a specific size. Returns a formatted markdown response with the download URL clearly presented, making it easy for LLMs to extract and use the URL.

**Parameters:**

- `uuid` (required): The image service UUID
- `size` (required): The preferred size (e.g., 'thumbnail', 'small', 'medium', 'large')

**Example:**

```json
{
  "name": "get_resized_image",
  "arguments": {
    "uuid": "abc123-def456-ghi789",
    "size": "thumbnail"
  }
}
```

**Response Format:**

The tool returns a formatted markdown response that includes:

- **Image UUID**: The image identifier used in the request
- **Requested Size**: The size that was requested
- **Download URL**: A signed URL to download the image at the requested size (with expiration notice)
- **Additional Information**: Any other fields returned by the API
- **Raw JSON Response**: The complete JSON response for reference

**Example Response:**

```
## Resized Image URL

**Image UUID:** abc123-def456-ghi789

**Requested Size:** thumbnail

**Download URL:** https://images.preview.hikari-systems.com/...

> This is a signed URL that can be used to download the image at the requested size. The URL includes authentication parameters and may expire.

---

**Raw JSON Response:**
The complete JSON response is also included at the end for programmatic access.
```

### upload_image

Uploads an image file without immediate resizing. Takes an image category and a local filename, reads the file, and uploads it to the image service with `forceImmediateResize` set to `false`.

**Parameters:**

- `category` (required): The image category
- `filename` (required): The local file path to upload

**Example:**

```json
{
  "name": "upload_image",
  "arguments": {
    "category": "products",
    "filename": "/path/to/image.jpg"
  }
}
```

### upload_and_resize_image

Uploads an image file and immediately resizes it. Takes an image category and a local filename, reads the file, and uploads it to the image service with `forceImmediateResize` set to `true`.

**Parameters:**

- `category` (required): The image category
- `filename` (required): The local file path to upload

**Example:**

```json
{
  "name": "upload_and_resize_image",
  "arguments": {
    "category": "products",
    "filename": "/path/to/image.jpg"
  }
}
```

## License

MIT
