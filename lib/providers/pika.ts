import "server-only";
import type { JobState, JSONSchema, ModelDetail, ModelSummary } from "../types";
import { ProviderError, extractError, isSafeModelId, readBody, requireEnv } from "../server";
import { buildInput, initialValue, schemaToFields, type FormField } from "../schema";

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

// Units that read naturally as "from $X/sec" etc. Anything else (per million
// "video_output_token", per thousand "output_megapixel", ...) says nothing
// useful about what one video costs, so those models show a quoted price for
// one typical video instead.
const PLAIN_UNITS: Record<string, string> = { second: "/sec", output_second: "/sec", minute: "/min", request: "/run" };

function usageBased(e: CatalogEntry): boolean {
  const unit = e.display_pricing?.components?.[0]?.unit;
  return !!unit?.type && !(unit.type in PLAIN_UNITS && (unit.quantity ?? 1) === 1);
}

// What one typical video costs: the quoted price and the clip length it was
// quoted for, "needs-video" when the price depends on an uploaded video (Pika
// can't price a placeholder), or null when Pika couldn't price it.
type PerVideo = { usd: number; seconds?: number; resolution?: string } | "needs-video" | null;

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

function priceLabel(e: CatalogEntry, perVideo?: PerVideo): string | undefined {
  const c = e.display_pricing?.components?.[0];
  const from = c?.starting_at?.sell_usd;
  if (!from) return undefined;
  if (!usageBased(e)) return `from $${from}${PLAIN_UNITS[c?.unit?.type ?? ""] ?? ""}`;
  if (perVideo === "needs-video") return "price depends on your video";
  if (perVideo) {
    const spec = [perVideo.seconds ? `${perVideo.seconds}s` : "", perVideo.resolution ?? ""].filter(Boolean).join(" ");
    return `≈ ${usd(perVideo.usd)} per ${spec ? `${spec} ` : ""}video`;
  }
  return "price shown before you generate";
}

// Same stand-in URL the Generate screen uses for its live quote.
const PLACEHOLDER_URL = "https://placeholder.invalid/input";
const TYPICAL_SECONDS = 5;
const PER_VIDEO_TTL_MS = 60 * 60 * 1000;
const PER_VIDEO_RETRY_MS = 5 * 60 * 1000;
const perVideoCache = new Map<string, { value: PerVideo; at: number }>();

// A required setting with no default (Seedance's duration, say) gets a typical
// value so the quote can be priced: 5 seconds for a length, 720p for a
// resolution, else the first choice.
function typicalValue(f: FormField): unknown {
  const isLength = /duration|second|length/i.test(f.name);
  if (f.kind === "enum" && f.enumValues?.length) {
    if (isLength && f.enumValues.some((v) => String(v) === String(TYPICAL_SECONDS))) return TYPICAL_SECONDS;
    if (/resolution/i.test(f.name) && f.enumValues.includes("720p")) return "720p";
    return f.enumValues.find((v) => typeof v === "number") ?? f.enumValues[0];
  }
  if (f.kind === "integer" || f.kind === "number") {
    if (isLength) return Math.min(Math.max(TYPICAL_SECONDS, f.min ?? TYPICAL_SECONDS), f.max ?? TYPICAL_SECONDS);
    return f.min;
  }
  return undefined;
}

// Price of one typical video from Pika's free quote endpoint: default
// settings, required images filled with a stand-in URL.
async function perVideoPrice(apiId: string): Promise<PerVideo> {
  const hit = perVideoCache.get(apiId);
  if (hit && Date.now() - hit.at < (hit.value === null ? PER_VIDEO_RETRY_MS : PER_VIDEO_TTL_MS)) return hit.value;
  let value: PerVideo = null;
  try {
    const detail = await fetch(`${BASE}/catalog/apis/${apiId}?expand=inputs`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
    if (detail.ok) {
      const fields = schemaToFields(((await detail.json()) as CatalogEntry).input_schema);
      const requiredMedia = fields.filter((f) => f.required && (f.kind === "media" || f.kind === "mediaList"));
      if (requiredMedia.some((f) => f.mediaKinds?.includes("video"))) {
        value = "needs-video";
      } else {
        const values = Object.fromEntries(
          fields.map((f) => {
            const v = initialValue(f);
            return [f.name, f.required && (v === undefined || v === "") ? typicalValue(f) : v];
          }),
        );
        const media: Record<string, string[]> = Object.fromEntries(
          requiredMedia.map((f) => [f.name, Array(Math.max(1, f.minItems ?? 1)).fill(PLACEHOLDER_URL)]),
        );
        const quoteOnce = async () => {
          const { input } = buildInput(fields, values, "A short test video", media);
          const res = await fetch(`${BASE}/catalog/apis/${apiId}/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
          });
          const n = res.ok ? Number(((await res.json()) as { sell_usd?: string }).sell_usd) : NaN;
          if (!Number.isFinite(n) || n <= 0) return null;
          const seconds = typeof input.duration === "number" && input.duration > 0 ? input.duration : undefined;
          const resolution = typeof input.resolution === "string" ? input.resolution : undefined;
          return { usd: n, seconds, resolution };
        };
        value = await quoteOnce();
        // Reference-to-video models need at least one reference: price it with one image.
        const imageSlot = fields.find((f) => !media[f.name] && (f.kind === "media" || f.kind === "mediaList") && f.mediaKinds?.includes("image"));
        if (!value && imageSlot) {
          media[imageSlot.name] = [PLACEHOLDER_URL];
          value = await quoteOnce();
        }
      }
    }
  } catch {
    // Timeout or network trouble: fall back to the generic label for now.
  }
  perVideoCache.set(apiId, { value, at: Date.now() });
  return value;
}

// Per-video prices for the usage-priced models, four lookups at a time. Stops
// waiting after `budgetMs` so the model list never stalls; lookups still
// running finish into the cache for the next load.
async function perVideoPrices(entries: CatalogEntry[], budgetMs = 4000): Promise<Map<string, PerVideo>> {
  const out = new Map<string, PerVideo>();
  const queue = entries.filter(usageBased).map((e) => e.api_id);
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) out.set(id, await perVideoPrice(id));
  };
  const all = Promise.all(Array.from({ length: 4 }, worker));
  await Promise.race([all, new Promise((r) => setTimeout(r, budgetMs))]);
  return new Map(out);
}

function toSummary(e: CatalogEntry, perVideo?: PerVideo): ModelSummary {
  const [, family] = e.api_id.split("/");
  return {
    provider: "pika",
    id: e.api_id,
    name: e.name,
    vendor: e.vendor,
    family: family ?? e.vendor,
    function: e.function,
    description: e.description ?? "",
    priceLabel: priceLabel(e, perVideo),
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
  const entries = await catalog();
  const perVideo = await perVideoPrices(entries);
  return entries.map((e) => toSummary(e, perVideo.get(e.api_id)));
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
  const perVideo = usageBased(e) ? await perVideoPrice(apiId) : undefined;
  return { ...toSummary(e, perVideo), schema: e.input_schema ?? { type: "object", properties: {} }, notes: [] };
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
