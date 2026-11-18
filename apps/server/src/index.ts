import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`[ontarget] servidor em http://localhost:${port}`);
