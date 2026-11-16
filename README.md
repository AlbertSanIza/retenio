This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Minimal MCP experiment

The same Next.js app serves an MCP endpoint at `/api/mcp`. Its single tool,
`hello`, accepts `{ "name": "Albert" }` and returns
`Hello, Albert! From Next.js via MCP.`

The implementation is in `app/api/mcp/route.ts`, using
[mcp-handler](https://github.com/vercel-labs/mcp-handler). This is a stateless,
unauthenticated demo with no database, API keys, or separate backend.

```bash
bun install
bun dev
```

In another terminal, call the tool directly:

```bash
curl -sS http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{"name":"Albert"}}}'
```

To discover the tool, use the same headers with
`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` as the body.
These direct requests use the adapter's stateless legacy protocol support.

For an MCP client, choose **Streamable HTTP** and set the URL to
`http://localhost:3000/api/mcp` (adjust the port if Next.js chooses another).
The client handles discovery/initialization. Opening the URL in a browser is
not a tool call; a plain GET returns 405.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
