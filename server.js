import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname.split("/").some(part => part.startsWith("."))) { res.writeHead(403); res.end(); return; }
      let file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": `${mime[extname(file)] || "application/octet-stream"}${[".html", ".js", ".css", ".json"].includes(extname(file)) ? "; charset=utf-8" : ""}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createAppServer().listen(port, "127.0.0.1", () => console.log(`Perfboard Editor: http://localhost:${port}`));
}
