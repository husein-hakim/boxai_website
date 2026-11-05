// Copies site/ to dist/ and fills in values that depend on the deployment:
// {{SITE_URL}}, {{POSTHOG_KEY}} and each page's FAQPage structured data, which is
// generated from the visible FAQ so the two can't drift apart.
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const siteUrl = (process.env.SITE_URL ?? (vercelHost ? `https://${vercelHost}` : "http://localhost:4173")).replace(/\/$/, "");
const posthogKey = process.env.POSTHOG_KEY ?? "";

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function faqSchema(html) {
  const items = [...html.matchAll(/<details class="faq"[^>]*><summary>(.*?)<\/summary><div>(.*?)<\/div><\/details>/gs)];
  if (!items.length) return "";
  const entity = items.map(([, question, answer]) => ({
    "@type": "Question",
    name: plain(question),
    acceptedAnswer: { "@type": "Answer", text: plain(answer) },
  }));
  return "," + JSON.stringify({ "@type": "FAQPage", mainEntity: entity });
}

function fill(path) {
  let text = readFileSync(path, "utf8");
  if (path.endsWith(".html")) text = text.replace("<!--faq-schema-->", faqSchema(text));
  text = text.replaceAll("{{SITE_URL}}", siteUrl).replaceAll("{{POSTHOG_KEY}}", posthogKey);
  writeFileSync(path, text);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if ([".html", ".js", ".txt", ".xml"].includes(extname(path))) fill(path);
  }
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, "site"), dist, { recursive: true });
walk(dist);
console.log(`Built dist/ for ${siteUrl}${posthogKey ? " with analytics" : ""}`);
