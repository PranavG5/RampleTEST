export type Provider = "pika" | "higgsfield";

export const PROVIDER_LABEL: Record<Provider, string> = {
  pika: "Pika",
  higgsfield: "Higgsfield",
};

export type MediaKind = "image" | "video" | "audio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JSONSchema = Record<string, any>;

export interface ModelSummary {
  provider: Provider;
  id: string; // Pika api_id or Higgsfield endpoint id
  name: string;
  vendor: string;
  family: string;
  function: string; // text-to-video, image-to-video, ...
  description: string;
  priceLabel?: string;
  docsUrl?: string;
}

export interface ModelDetail extends ModelSummary {
  schema: JSONSchema;
  notes: string[];
}

export type RunStatus = "uploading" | "submitting" | "queued" | "running" | "completed" | "failed";

export interface JobState {
  status: "queued" | "running" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
  costUsd?: number;
  runtimeS?: number;
}

export interface Run {
  id: string;
  provider: Provider;
  modelId: string;
  modelName: string;
  modelFunction: string;
  prompt: string;
  input: Record<string, unknown>;
  inputFileNames: string[];
  jobId?: string;
  status: RunStatus;
  videoUrl?: string;
  error?: string;
  quotedUsd?: number;
  costUsd?: number;
  runtimeS?: number;
  createdAt: number;
  finishedAt?: number;
  rating?: number; // 1-5
  notes?: string;
  tags?: string[];
}
