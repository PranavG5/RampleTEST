#!/usr/bin/env node
// Builds data/higgsfield-models.json from Higgsfield's public docs.
// Higgsfield has no machine-readable catalog of every video model, so this
// walks docs.higgsfield.ai: video index -> model family pages -> workflow pages,
// and pulls each workflow's endpoint ID and complete JSON input schema.
//
// Run: npm run sync:higgsfield

import { writeFile, mkdir } from "node:fs/promises";

const BASE = "https://docs.higgsfield.ai/docs";
const INDEX = `${BASE}/models/video-generation.md`;

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`Failed to fetch ${url}`);
}

function parseFamilies(md) {
  // Cards look like: [ByteDanceVideo · 3 workflows\nSeedance 2.0\nDescription\nView API reference →](url)
  const out = [];
  const re = /\[([^\]]*?)·\s*\d+\s*workflows?\s*\n([^\n]+)\n([^\n]*)\n[^\]]*\]\((https:\/\/docs\.higgsfield\.ai\/docs\/models\/[^)]+\.md)\)/g;
  let m;
  while ((m = re.exec(md))) {
    out.push({
      vendor: m[1].trim().replace(/Video$/, ""),
      name: m[2].trim(),
      description: m[3].trim(),
      url: m[4],
    });
  }
  return out;
}

function parseWorkflows(md) {
  // | [Pro · Text to video](https://...md) | `POST /kling-video/v3.0/pro/text-to-video` |
  const out = [];
  const re = /\|\s*\[([^\]]+)\]\((https:\/\/[^)]+\.md)\)\s*\|\s*`(POST|GET)\s+([^`]+)`\s*\|/g;
  let m;
  while ((m = re.exec(md))) out.push({ workflow: m[1].trim(), url: m[2], path: m[4].trim() });
  return out;
}

function parseWorkflowPage(md) {
  const idMatch = md.match(/\*\*Endpoint ID:\*\*\s*`([^`]+)`/);
  const notes = [];
  const notesBlock = md.match(/## Usage notes\s*\n([\s\S]*?)\n## /);
  if (notesBlock) {
    for (const line of notesBlock[1].split("\n")) {
      const t = line.replace(/^\s*\*\s*/, "").trim();
      if (t) notes.push(t.replace(/\\_/g, "_"));
    }
  }
  // Complete JSON schema is a blockquoted fenced block: "> ```json ..." ... "> ```"
  let schema = null;
  const schemaIdx = md.indexOf("**Complete JSON schema**");
  if (schemaIdx >= 0) {
    const rest = md.slice(schemaIdx).split("\n");
    const lines = [];
    let inside = false;
    for (const raw of rest) {
      const line = raw.replace(/^>\s?/, "");
      if (!inside && line.trim().startsWith("```json")) {
        inside = true;
        continue;
      }
      if (inside && line.trim().startsWith("```")) break;
      if (inside) lines.push(line);
    }
    try {
      schema = JSON.parse(lines.join("\n"));
    } catch (e) {
      schema = null;
    }
  }
  const desc = md.match(/^>\s+([^\n]+)$/m);
  return { endpointId: idMatch?.[1], notes, schema, summary: desc?.[1] };
}

const indexMd = await get(INDEX);
const families = parseFamilies(indexMd);
console.log(`Found ${families.length} model families`);

const models = [];
for (const fam of families) {
  const famMd = await get(fam.url);
  if (!famMd) continue;
  const workflows = parseWorkflows(famMd);
  for (const wf of workflows) {
    const wfMd = await get(wf.url);
    if (!wfMd) continue;
    const parsed = parseWorkflowPage(wfMd);
    const id = parsed.endpointId || wf.path.replace(/^\//, "");
    models.push({
      id,
      family: fam.name,
      vendor: fam.vendor,
      workflow: wf.workflow,
      description: fam.description,
      path: "/" + id,
      docsUrl: wf.url.replace(/\.md$/, ""),
      notes: parsed.notes,
      schema: parsed.schema,
    });
    process.stdout.write(parsed.schema ? "." : "x");
  }
}
console.log(`\nCollected ${models.length} workflows (${models.filter((m) => !m.schema).length} without schema)`);

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/higgsfield-models.json", import.meta.url),
  JSON.stringify({ syncedAt: new Date().toISOString(), source: INDEX, models }, null, 2) + "\n",
);
console.log("Wrote data/higgsfield-models.json");
