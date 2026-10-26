import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";

export interface SmartHttpServer {
  url: string;
  stats: { unauthorized: number; requests: string[] };
  close: () => Promise<void>;
}

export async function startSmartHttpServer(options: {
  root: string;
  username: string;
  password: string;
  delayMs?: number;
}): Promise<SmartHttpServer> {
  const stats = { unauthorized: 0, requests: [] as string[] };
  const expected = Buffer.from(`${options.username}:${options.password}`).toString("base64");

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String(error));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const authorization = String(request.headers.authorization ?? "");
    if (authorization !== `Basic ${expected}`) {
      stats.unauthorized += 1;
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="vaultdesk-e2e"' });
      response.end("authentication required");
      return;
    }
    stats.requests.push(`${request.method ?? "GET"} ${url.pathname}`);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const body = await readBody(request);
    const payload = request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_PROJECT_ROOT: options.root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? "GET",
      CONTENT_TYPE: String(request.headers["content-type"] ?? ""),
      CONTENT_LENGTH: String(payload.byteLength),
      REMOTE_USER: options.username,
      REMOTE_ADDR: "127.0.0.1",
      SERVER_PROTOCOL: "HTTP/1.1",
    };
    if (request.headers["git-protocol"]) env.GIT_PROTOCOL = String(request.headers["git-protocol"]);
    const child = spawn("git", ["http-backend"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.stdin.on("error", () => undefined);
    child.stdin.end(payload);
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    const output = Buffer.concat(chunks);
    const split = findHeaderEnd(output);
    if (split < 0) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(
        `git http-backend produced no headers (exit ${exitCode}): ${Buffer.concat(errors).toString("utf8")}`,
      );
      return;
    }
    const headers: Record<string, string> = {};
    let statusCode = 200;
    for (const line of output.subarray(0, split.index).toString("utf8").split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (key.toLowerCase() === "status") {
        statusCode = Number.parseInt(value, 10);
      } else {
        headers[key] = value;
      }
    }
    response.writeHead(statusCode, headers);
    response.end(output.subarray(split.next));
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    stats,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function findHeaderEnd(output: Buffer): { index: number; next: number } | null {
  const crlf = output.indexOf("\r\n\r\n");
  if (crlf >= 0) return { index: crlf, next: crlf + 4 };
  const lf = output.indexOf("\n\n");
  if (lf >= 0) return { index: lf, next: lf + 2 };
  return null;
}
