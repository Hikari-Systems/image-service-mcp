# Hello World MCP Server

A simple Model Context Protocol (MCP) server that demonstrates basic functionality.

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
npx @hikari-systems/image-service-mcp --base-url <url> --api-key <key>
```

**Example:**

```bash
npx @hikari-systems/image-service-mcp --base-url http://localhost:3020 --api-key sdflkjghwiuryt32452345
```

### Command-Line Arguments

- `--base-url` (required): The base URL for the image service API (e.g., `http://localhost:3020`)
- `--api-key` (required): The API key for authenticating with the image service

## Local Development with npx

To test locally with npx before publishing:

```bash
# Build the project
npm run build

# Link the package locally
npm link

# Run with npx (using the scoped package name)
npx @hikari-systems/image-service-mcp --base-url http://localhost:3020 --api-key your-api-key
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

### hello_world

Returns a friendly hello world message.

**Parameters:**

- `name` (optional): Name to greet (defaults to "World")

**Example:**

```json
{
  "name": "hello_world",
  "arguments": {
    "name": "Alice"
  }
}
```

## License

MIT
# image-service-mcp
