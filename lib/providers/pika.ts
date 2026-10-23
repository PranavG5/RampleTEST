import "server-only";
import type { JobState, JSONSchema, ModelDetail, ModelSummary } from "../types";
import { ProviderError, extractError, isSafeModelId, readBody, requireEnv } from "../server";

// Pika Business API (https://dev.pika.art). One key, many vendors' models.
const BASE = "https://api.dev.pika.art";

interface CatalogEntry {
  api_id: string;
  vendor: string;
  function: string;
  category: string;
  name: string;
  description?: string;
  display_pricing?: {
    components?: {
      unit?: { type?: string; quantity?: number };
      starting_at?: { sell_usd?: string };
    }[];
  };
  call?: { method: string; path: string };
  input_schema?: JSONSchema;
}

function key(): string {
  return requireEnv("PIKA_API_KEY", "Add your Pika API key in the Vercel project settings.");
}

function priceLabel(e: CatalogEntry): string | undefined {
  const c = e.display_pricing?.components?.[0];
  const usd = c?.starting_at?.sell_usd;
  if (!usd) return undefined;
  const unit = c?.unit?.type;
  const per = unit === "second" ? "/sec" : unit === "request" ? "/run" : unit ? `/${unit}` : "";
  return `from $${usd}${per}`;
}

function toSummary(e: CatalogEntry): ModelSummary {
  const [, family] = e.api_id.split("/");
  return {
    provider: "pika",
    id: e.api_id,
    name: e.name,
    vendor: e.vendor,
    family: family ?? e.vendor,
    function: e.function,
    description: e.description ?? "",
    priceLabel: priceLabel(e),
    docsUrl: `https://dev.pika.art/models`,
  };
}

async function catalog(): Promise<CatalogEntry[]> {
  // Public endpoint; cached for an hour so new models show up without a redeploy.
  const res = await fetch(`${BASE}/catalog/apis`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new ProviderError(502, `Pika catalog returned ${res.status}`);
  const body = (await res.json()) as { apis: CatalogEntry[] };
  return body.apis.filter((a) => a.category === "video");
}

export async function listPikaModels(): Promise<ModelSummary[]> {
  return (await catalog()).map(toSummary);
}

async function assertKnown(apiId: string): Promise<CatalogEntry> {
  if (!isSafeModelId(apiId)) throw new ProviderError(400, "Invalid model id");
  const entry = (await catalog()).find((a) => a.api_id === apiId);
  if (!entry) throw new ProviderError(404, `Unknown Pika video model: ${apiId}`);
  return entry;
}

export async function getPikaModel(apiId: string): Promise<ModelDetail> {
  await assertKnown(apiId);
  const res = await fetch(`${BASE}/catalog/apis/${apiId}?expand=inputs`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new ProviderError(502, `Pika catalog returned ${res.status} for ${apiId}`);
  const e = (await res.json()) as CatalogEntry;
  return { ...toSummary(e), schema: e.input_schema ?? { type: "object", properties: {} }, notes: [] };
}

export async function quotePika(apiId: string, input: Record<string, unknown>): Promise<number> {
  await assertKnown(apiId);
  const res = await fetch(`${BASE}/catalog/apis/${apiId}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = await readBody(res);
  if (!res.ok) throw new ProviderError(res.status, extractError(body, `Quote failed (${res.status})`));
  return Number((body as { sell_usd: string }).sell_usd);
}

export async function submitPika(apiId: string, input: Record<string, unknown>): Promise<string> {
  const entry = await assertKnown(apiId);
  const path = entry.call?.path ?? `/v1/media/${apiId}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": key(),
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await readBody(res)) as { id?: string; status?: string; error?: unknown };
  if (!res.ok || body?.status === "failed" || !body?.id) {
    throw new ProviderError(res.ok ? 502 : res.status, extractError(body, `Pika rejected the request (${res.status})`));
  }
  return body.id;
}

export async function getPikaJob(jobId: string): Promise<JobState> {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(jobId)) throw new ProviderError(400, "Invalid job id");
  const res = await fetch(`${BASE}/v1/media/jobs/${jobId}`, {
    headers: { "X-API-Key": key() },
    cache: "no-store",
  });
  const body = (await readBody(res)) as {
    status?: string;
    output?: { video?: { url?: string }; videos?: { url?: string }[] } | null;
    error?: { message?: string; code?: string } | null;
    billing?: { state?: string; charge_micro_usd?: number } | null;
    runtime_s?: number | null;
  };
  if (!res.ok) throw new ProviderError(res.status, extractError(body, `Pika job lookup failed (${res.status})`));

  const status = body.status === "completed" ? "completed" : body.status === "failed" ? "failed" : body.status === "running" ? "running" : "queued";
  const videoUrl = body.output?.video?.url ?? body.output?.videos?.[0]?.url ?? undefined;
  return {
    status: status === "completed" && !videoUrl ? "failed" : status,
    videoUrl,
    error:
      status === "failed"
        ? extractError(body, "Generation failed")
        : status === "completed" && !videoUrl
          ? "Job finished but returned no video"
          : undefined,
    costUsd: body.billing?.state === "settled" && typeof body.billing.charge_micro_usd === "number" ? body.billing.charge_micro_usd / 1e6 : undefined,
    runtimeS: body.runtime_s ?? undefined,
  };
}

export async function pikaUploadTarget(contentType: string, size: number) {
  const res = await fetch(`${BASE}/v1/media/uploads`, {
    method: "POST",
    headers: { "X-API-Key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, size_bytes: size }),
    cache: "no-store",
  });
  const body = (await readBody(res)) as { upload_url?: string; url?: string; headers?: Record<string, string> };
  if (!res.ok || !body?.url) throw new ProviderError(res.status || 502, extractError(body, `Pika upload setup failed (${res.status})`));
  return { uploadUrl: body.upload_url, headers: body.headers ?? {}, publicUrl: body.url };
}
