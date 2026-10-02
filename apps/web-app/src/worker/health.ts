import { createServer } from "node:http";

export async function startWorkerHealthServer(options: {
  port: number;
  host?: string;
  isReady: () => boolean;
}): Promise<{ port: number; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const status = request.url === "/live" ? 200 : request.url === "/ready" ? (options.isReady() ? 200 : 503) : 404;
    response.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end(status === 200 ? "ok\n" : "unavailable\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Worker health server has no TCP address");
  let closing: Promise<void> | undefined;
  return {
    port: address.port,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
