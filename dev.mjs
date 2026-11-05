// Local preview: builds the site, serves dist/ and runs the real API handler, with
// Resend replaced by a stub that appends signups to .waitlist-dev.jsonl. Sends nothing.
// A second signup with the same email gets a 409. An email containing "fail" gets a 500.
import "./build.mjs";
import { createServer } from "node:http";
import { appendFile, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/waitlist.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const log = join(root, ".waitlist-dev.jsonl");
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };
const seen = new Set();

process.env.RESEND_API_KEY = "dev";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://api.resend.com/")) return realFetch(url, init);
  const { email } = JSON.parse(init.body);
  if (email.includes("fail")) return new Response("stub failure", { status: 500 });
  if (seen.has(email)) return new Response("exists", { status: 409 });
  seen.add(email);
  await appendFile(log, init.body + "\n");
  return new Response("{}", { status: 201 });
};

createServer(async (req, res) => {
  const path = normalize(new URL(req.url, "http://localhost").pathname);

  if (path === "/api/waitlist") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const isForm = (req.headers["content-type"] ?? "").includes("urlencoded");
    try {
      req.body = isForm ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : {};
    } catch {
      req.body = {};
    }
    return handler(req, res);
  }

  const file = path === "/" ? "index.html" : extname(path) ? path : `${path}.html`;
  try {
    const data = await readFile(join(dist, file));
    res.setHeader("Content-Type", `${types[extname(file)] ?? "application/octet-stream"}; charset=utf-8`);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
