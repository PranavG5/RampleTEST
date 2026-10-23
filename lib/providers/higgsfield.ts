import "server-only";
import catalogFile from "@/data/higgsfield-models.json";
import type { JobState, JSONSchema, ModelDetail, ModelSummary } from "../types";
import { ProviderError, extractError, isSafeModelId, readBody } from "../server";

// Higgsfield API (https://docs.higgsfield.ai). The model list comes from
// data/higgsfield-models.json, built by `npm run sync:higgsfield`.
const BASE = "https://api.higgsfield.ai";

interface HfEntry {
  id: string;
  family: string;
  vendor: string;
  workflow: string;
  description: string;
  path: string;
  docsUrl: string;
  notes: string[];
  schema: JSONSchema | null;
}

const entries = (catalogFile as { models: HfEntry[] }).models;

function authHeader(): string {
  const id = process.env.HIGGSFIELD_API_KEY_ID;
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET;
  if (!id || !secret) {
    throw new ProviderError(
      500,
      "HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET are not set. Add them in the Vercel project settings.",
    );
  }
  return `Key ${id}:${secret}`;
}

export function classifyFunction(id: string, workflow: string): string {
  const s = `${id} ${workflow}`.toLowerCase();
  if (s.includes("text-to-video") || s.includes("text to video")) return "text-to-video";
  if (s.includes("image-to-video") || s.includes("image to video") || s.includes("first-last") || s.includes("first/last")) return "image-to-video";
  if (s.includes("reference")) return "reference-to-video";
  if (s.includes("motion")) return "motion-control";
  if (s.includes("extend")) return "video-extension";
  if (/edit|restyle|swap|video-to-video/.test(s)) return "video-to-video";
  return "other";
}

function toSummary(e: HfEntry): ModelSummary {
  return {
    provider: "higgsfield",
    id: e.id,
    name: `${e.family} · ${e.workflow}`,
    vendor: e.vendor,
    family: e.family,
    function: classifyFunction(e.id, e.workflow),
    description: e.description,
    docsUrl: e.docsUrl,
  };
}

export function listHiggsfieldModels(): ModelSummary[] {
  return entries.map(toSummary);
}

function find(id: string): HfEntry {
  if (!isSafeModelId(id)) throw new ProviderError(400, "Invalid model id");
  const e = entries.find((x) => x.id === id);
  if (!e) throw new ProviderError(404, `Unknown Higgsfield model: ${id}`);
  return e;
}

export function getHiggsfieldModel(id: string): ModelDetail {
  const e = find(id);
  return { ...toSummary(e), schema: e.schema ?? { type: "object", properties: {} }, notes: e.notes };
}

export async function submitHiggsfield(id: string, input: Record<string, unknown>): Promise<string> {
  const e = find(id);
  const res = await fetch(`${BASE}/${e.id}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await readBody(res)) as { request_id?: string };
  if (!res.ok || !body?.request_id) {
    throw new ProviderError(res.ok ? 502 : res.status, extractError(body, `Higgsfield rejected the request (${res.status})`));
  }
  return body.request_id;
}

function firstUrl(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = firstUrl(x);
      if (u) return u;
    }
    return undefined;
  }
  const o = v as Record<string, unknown>;
  return typeof o.url === "string" ? o.url : undefined;
}

export async function getHiggsfieldJob(requestId: string): Promise<JobState> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new ProviderError(400, "Invalid request id");
  const res = await fetch(`${BASE}/requests/${requestId}/status`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  const body = (await readBody(res)) as {
    status?: string;
    error?: string | null;
    video?: { url?: string };
    videos?: { url?: string }[];
  };
  if (!res.ok) throw new ProviderError(res.status, extractError(body, `Higgsfield status lookup failed (${res.status})`));

  switch (body.status) {
    case "completed": {
      const videoUrl = firstUrl(body.video) ?? firstUrl(body.videos);
      return videoUrl ? { status: "completed", videoUrl } : { status: "failed", error: "Request finished but returned no video" };
    }
    case "failed":
      return { status: "failed", error: body.error || "Generation failed" };
    case "nsfw":
      return { status: "failed", error: "Blocked by Higgsfield content moderation (nsfw)" };
    case "canceled":
      return { status: "failed", error: "Request was canceled" };
    case "in_progress":
      return { status: "running" };
    default:
      return { status: "queued" };
  }
}

export const HIGGSFIELD_UPLOAD_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "video/mp4"];

export async function higgsfieldUploadTarget(contentType: string) {
  if (!HIGGSFIELD_UPLOAD_TYPES.includes(contentType)) {
    throw new ProviderError(415, `Higgsfield accepts JPEG, PNG, WEBP, GIF images and MP4 video. This file is ${contentType || "an unknown type"}.`);
  }
  const res = await fetch(`${BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType }),
    cache: "no-store",
  });
  const body = (await readBody(res)) as { upload_url?: string; public_url?: string; upload_headers?: Record<string, string> };
  if (!res.ok || !body?.upload_url || !body.public_url) {
    throw new ProviderError(res.status || 502, extractError(body, `Higgsfield upload setup failed (${res.status})`));
  }
  return { uploadUrl: body.upload_url, headers: body.upload_headers ?? {}, publicUrl: body.public_url };
}
