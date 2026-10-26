import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

// A regression run must not invalidate a developer's running Vite cache.
const cacheDir = await mkdtemp(path.resolve("node_modules/.vite-dev-test-"));
const server = await createServer({
  cacheDir,
  optimizeDeps: { force: true },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
});
async function close() {
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close().then(() => process.exit(0));
  });
try {
  await server.listen();
  server.printUrls();
} catch (error) {
  await close();
  throw error;
}
