import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "hello",
    {
      description: "Say hello from the Next.js MCP server.",
      inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}! From Next.js via MCP.` }],
    }),
  );
});

export { handler as GET, handler as POST };
