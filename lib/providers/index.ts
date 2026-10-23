import "server-only";
import type { JobState, ModelDetail, ModelSummary, Provider } from "../types";
import { ProviderError } from "../server";
import { getPikaJob, getPikaModel, listPikaModels, pikaUploadTarget, quotePika, submitPika } from "./pika";
import { getHiggsfieldJob, getHiggsfieldModel, higgsfieldUploadTarget, listHiggsfieldModels, submitHiggsfield } from "./higgsfield";

export function parseProvider(v: unknown): Provider {
  if (v === "pika" || v === "higgsfield") return v;
  throw new ProviderError(400, "provider must be 'pika' or 'higgsfield'");
}

export async function listModels(p: Provider): Promise<ModelSummary[]> {
  return p === "pika" ? listPikaModels() : listHiggsfieldModels();
}

export async function getModel(p: Provider, id: string): Promise<ModelDetail> {
  return p === "pika" ? getPikaModel(id) : getHiggsfieldModel(id);
}

export async function submit(p: Provider, id: string, input: Record<string, unknown>): Promise<string> {
  return p === "pika" ? submitPika(id, input) : submitHiggsfield(id, input);
}

export async function jobStatus(p: Provider, jobId: string): Promise<JobState> {
  return p === "pika" ? getPikaJob(jobId) : getHiggsfieldJob(jobId);
}

export async function quote(p: Provider, id: string, input: Record<string, unknown>): Promise<number | null> {
  return p === "pika" ? quotePika(id, input) : null; // Higgsfield has no public quote endpoint
}

export async function uploadTarget(p: Provider, contentType: string, size: number) {
  return p === "pika" ? pikaUploadTarget(contentType, size) : higgsfieldUploadTarget(contentType);
}
