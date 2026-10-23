"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InputsPanel from "@/components/InputsPanel";
import ModelForm from "@/components/ModelForm";
import ModelPicker from "@/components/ModelPicker";
import Results from "@/components/Results";
import { extractText, makeAsset, type Asset } from "@/lib/extract";
import { loadRuns, saveRuns } from "@/lib/history";
import { buildInput, collectFileRefs, initialValue, replaceFileRefs, schemaToFields, type FormField } from "@/lib/schema";
import type { JobState, ModelDetail, ModelSummary, Provider, Run } from "@/lib/types";
import { uploadAsset } from "@/lib/upload";

type Values = Record<string, unknown>;
const ACTIVE = new Set(["uploading", "submitting", "queued", "running"]);
const POLLABLE = new Set(["queued", "running"]);
const PLACEHOLDER_URL = "https://placeholder.invalid/input";
const keyOf = (p: Provider, id: string) => `${p}:${id}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Signed out");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function isMedia(f: FormField) {
  return f.kind === "media" || f.kind === "mediaList";
}

// Fill required media slots (or the first slot if none are required) with matching uploads.
function autofillMedia(fields: FormField[], values: Values, assets: Asset[]): Values | null {
  const media = fields.filter(isMedia);
  const targets = media.some((f) => f.required) ? media.filter((f) => f.required) : media.slice(0, 1);
  let changed = false;
  const next = { ...values };
  for (const f of targets) {
    if (((next[f.name] as string[]) ?? []).length) continue;
    const matching = assets.filter((a) => (f.mediaKinds as string[] | undefined)?.includes(a.kind));
    if (!matching.length) continue;
    const refs = matching.map((a) => `asset:${a.id}`);
    next[f.name] = f.kind === "media" ? refs.slice(0, 1) : refs.slice(0, f.maxItems ?? refs.length);
    changed = true;
  }
  return changed ? next : null;
}

export default function Studio() {
  const [tab, setTab] = useState<"generate" | "results">("generate");
  const [provider, setProvider] = useState<Provider>("pika");
  const [models, setModels] = useState<Record<Provider, ModelSummary[] | null>>({ pika: null, higgsfield: null });
  const [loadError, setLoadError] = useState<Record<Provider, string | null>>({ pika: null, higgsfield: null });

  const [selected, setSelected] = useState<ModelSummary | null>(null);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailCache = useRef(new Map<string, ModelDetail>());
  const selectedKey = useRef<string | null>(null);

  const [valuesByModel, setValuesByModel] = useState<Record<string, Values>>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [preDraftPrompt, setPreDraftPrompt] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [quote, setQuote] = useState<{ usd: number | null; error: string | null; loading: boolean }>({ usd: null, error: null, loading: false });
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [runs, setRuns] = useState<Run[]>([]);
  const runsLoaded = useRef(false);
  const pendingReuse = useRef<Run | null>(null);

  // ---------- load model lists + history ----------
  useEffect(() => {
    (["pika", "higgsfield"] as Provider[]).forEach((p) =>
      api<{ models: ModelSummary[] }>(`/api/models?provider=${p}`)
        .then((r) => setModels((m) => ({ ...m, [p]: r.models })))
        .catch((e: Error) => setLoadError((l) => ({ ...l, [p]: e.message }))),
    );
    const saved = loadRuns().map((r) =>
      r.status === "uploading" || r.status === "submitting"
        ? { ...r, status: "failed" as const, error: "Interrupted: the page closed before the job reached the provider." }
        : r,
    );
    setRuns(saved);
    runsLoaded.current = true;
  }, []);

  useEffect(() => {
    if (runsLoaded.current) saveRuns(runs);
  }, [runs]);

  const updateRun = useCallback((id: string, patch: Partial<Run>) => {
    setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  // ---------- selected model ----------
  const fields = useMemo(() => schemaToFields(detail?.schema), [detail]);
  const modelKey = detail ? keyOf(detail.provider, detail.id) : null;
  const values: Values = useMemo(() => (modelKey ? valuesByModel[modelKey] ?? {} : {}), [modelKey, valuesByModel]);
  const promptField = fields.find((f) => f.kind === "prompt");

  const setValues = useCallback(
    (next: Values) => {
      if (modelKey) setValuesByModel((v) => ({ ...v, [modelKey]: next }));
    },
    [modelKey],
  );

  const selectModel = useCallback(async (m: ModelSummary) => {
    setSelected(m);
    setFormErrors([]);
    setDetailError(null);
    const k = keyOf(m.provider, m.id);
    selectedKey.current = k;
    const cached = detailCache.current.get(k);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    try {
      const { model } = await api<{ model: ModelDetail }>(`/api/models/detail?provider=${m.provider}&id=${encodeURIComponent(m.id)}`);
      detailCache.current.set(k, model);
      if (selectedKey.current === k) setDetail(model);
    } catch (e) {
      if (selectedKey.current === k) setDetailError((e as Error).message);
    } finally {
      if (selectedKey.current === k) setDetailLoading(false);
    }
  }, []);

  // First time a model is opened: defaults + media autofill. Also apply a pending "reuse".
  const hasValues = modelKey ? !!valuesByModel[modelKey] : false;
  useEffect(() => {
    if (!detail || !modelKey) return;
    const reuse = pendingReuse.current;
    if (reuse && keyOf(reuse.provider, reuse.modelId) === modelKey) {
      pendingReuse.current = null;
      const v: Values = {};
      for (const f of fields) {
        const raw = reuse.input[f.name];
        if (raw === undefined) v[f.name] = initialValue(f);
        else if (isMedia(f)) v[f.name] = Array.isArray(raw) ? raw : [raw];
        else if (f.kind === "json") v[f.name] = JSON.stringify(raw, null, 2);
        else if (f.kind === "stringList") v[f.name] = Array.isArray(raw) ? raw.join("\n") : String(raw);
        else v[f.name] = raw;
      }
      setValuesByModel((all) => ({ ...all, [modelKey]: v }));
      return;
    }
    if (!valuesByModel[modelKey]) {
      const init: Values = {};
      for (const f of fields) init[f.name] = initialValue(f);
      setValuesByModel((all) => ({ ...all, [modelKey]: autofillMedia(fields, init, assets) ?? init }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, modelKey, fields, hasValues]);

  // New uploads fill empty required media slots of the open model.
  useEffect(() => {
    if (!modelKey || !valuesByModel[modelKey]) return;
    const next = autofillMedia(fields, valuesByModel[modelKey], assets);
    if (next) setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  // ---------- assets ----------
  const addFiles = useCallback((files: File[]) => {
    const added: Asset[] = [];
    const rej: string[] = [];
    for (const f of files) {
      const a = makeAsset(f);
      if ("rejected" in a) rej.push(a.rejected);
      else added.push(a.kind === "document" ? { ...a, extracting: true } : a);
    }
    setRejected(rej);
    if (!added.length) return;
    setAssets((as) => [...as, ...added]);
    for (const a of added.filter((x) => x.kind === "document")) {
      extractText(a.file)
        .then((text) => setAssets((as) => as.map((x) => (x.id === a.id ? { ...x, text, extracting: false } : x))))
        .catch((e: Error) => setAssets((as) => as.map((x) => (x.id === a.id ? { ...x, textError: e.message, extracting: false } : x))));
    }
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssets((as) => {
      const gone = as.find((a) => a.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return as.filter((a) => a.id !== id);
    });
    const ref = `asset:${id}`;
    setValuesByModel((all) => {
      const out: Record<string, Values> = {};
      for (const [k, v] of Object.entries(all)) {
        out[k] = Object.fromEntries(Object.entries(v).map(([n, val]) => [n, Array.isArray(val) ? val.filter((x) => x !== ref) : val]));
      }
      return out;
    });
  }, []);

  // ---------- media refs -> URLs ----------
  const mediaRefs = useCallback(
    () => Object.fromEntries(fields.filter(isMedia).map((f) => [f.name, ((values[f.name] as string[]) ?? []).filter(Boolean)])),
    [fields, values],
  );

  // ---------- live price (Pika only, free endpoint) ----------
  useEffect(() => {
    if (!detail || detail.provider !== "pika") {
      setQuote({ usd: null, error: null, loading: false });
      return;
    }
    const placeholders = Object.fromEntries(Object.entries(mediaRefs()).map(([k, refs]) => [k, refs.map(() => PLACEHOLDER_URL)]));
    const built = buildInput(fields, values, prompt, placeholders);
    const errors = built.errors;
    const input = replaceFileRefs(
      built.input,
      Object.fromEntries([...collectFileRefs(built.input)].map((n) => [n, PLACEHOLDER_URL])),
    ) as Record<string, unknown>;
    if (errors.length) {
      setQuote({ usd: null, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setQuote((q) => ({ ...q, loading: true }));
    const t = setTimeout(() => {
      api<{ usd: number | null }>("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: detail.provider, id: detail.id, input }),
        signal: ctrl.signal,
      })
        .then((r) => setQuote({ usd: r.usd, error: null, loading: false }))
        .catch((e: Error) => !ctrl.signal.aborted && setQuote({ usd: null, error: e.message, loading: false }));
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [detail, fields, values, prompt, mediaRefs]);

  // ---------- Claude prompt draft ----------
  async function draftPrompt() {
    setDraftError(null);
    const documents = assets.filter((a) => a.kind === "document" && a.text).map((a) => ({ name: a.name, text: a.text! }));
    const usedRefs = new Set(Object.values(mediaRefs()).flat());
    const media = assets.filter((a) => a.kind !== "document" && (!detail || usedRefs.has(`asset:${a.id}`)));
    const payload = JSON.stringify({
      model: detail
        ? {
            name: detail.name,
            function: detail.function,
            notes: detail.notes,
            promptMaxLength: promptField?.maxLength,
            mediaFields: fields.filter(isMedia).map((f) => f.label),
          }
        : undefined,
      idea: prompt,
      documents,
      mediaFiles: media.map((a) => ({ name: a.name, kind: a.kind })),
    });
    if (payload.length > 4_000_000) {
      setDraftError(`Your documents add up to ${(payload.length / 1e6).toFixed(1)} MB of text, over the 4 MB limit. Remove a file or trim its text.`);
      return;
    }
    if (!documents.length && !prompt.trim() && !media.length) {
      setDraftError("Add a document, an image, or a rough idea in the prompt box first.");
      return;
    }
    setDrafting(true);
    try {
      const r = await api<{ prompt: string }>("/api/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      setPreDraftPrompt(prompt);
      setPrompt(r.prompt);
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  // ---------- generate ----------
  async function generate() {
    if (!detail) return;
    const refs = mediaRefs();
    const placeholders = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.map(() => PLACEHOLDER_URL)]));
    const pre = buildInput(fields, values, prompt, placeholders);
    if (promptField?.maxLength && prompt.length > promptField.maxLength) {
      pre.errors.push(`Prompt is ${prompt.length} characters; this model allows ${promptField.maxLength}`);
    }
    if (!fields.length && !prompt.trim()) pre.errors.push("Add a prompt");
    // "@file:name" references inside advanced JSON fields
    const jsonInput = Object.fromEntries(fields.filter((f) => f.kind === "json").map((f) => [f.name, pre.input[f.name]]));
    const fileNames = [...collectFileRefs(jsonInput)];
    const fileAssets: Asset[] = [];
    for (const n of fileNames) {
      const a = assets.find((x) => x.name === n && x.kind !== "document");
      if (a) fileAssets.push(a);
      else pre.errors.push(`"@file:${n}" doesn't match an uploaded image or video`);
    }
    setFormErrors(pre.errors);
    if (pre.errors.length) return;

    const usedAssets = [
      ...new Set([
        ...[...new Set(Object.values(refs).flat())]
          .filter((r) => r.startsWith("asset:"))
          .map((r) => assets.find((a) => `asset:${a.id}` === r))
          .filter((a): a is Asset => !!a),
        ...fileAssets,
      ]),
    ];

    const run: Run = {
      id: crypto.randomUUID(),
      provider: detail.provider,
      modelId: detail.id,
      modelName: detail.name,
      modelFunction: detail.function,
      prompt: promptField ? prompt.trim() : "",
      input: {},
      inputFileNames: usedAssets.map((a) => a.name),
      status: usedAssets.length ? "uploading" : "submitting",
      createdAt: Date.now(),
    };
    setRuns((rs) => [run, ...rs]);
    setBusy(true);
    setNotice(null);
    try {
      const resolved: Record<string, string[]> = {};
      for (const [field, list] of Object.entries(refs)) {
        resolved[field] = [];
        for (const ref of list) {
          if (!ref.startsWith("asset:")) {
            resolved[field].push(ref);
            continue;
          }
          const asset = assets.find((a) => `asset:${a.id}` === ref);
          if (!asset) continue;
          resolved[field].push(await uploadAsset(asset, detail.provider));
        }
      }
      const fileUrls: Record<string, string> = {};
      for (const a of fileAssets) fileUrls[a.name] = await uploadAsset(a, detail.provider);
      const built = buildInput(fields, values, prompt, resolved).input;
      const input = fileAssets.length ? (replaceFileRefs(built, fileUrls) as Record<string, unknown>) : built;
      updateRun(run.id, { status: "submitting", input });

      let quotedUsd: number | undefined;
      if (detail.provider === "pika") {
        // Free check that also validates the body before any money is spent.
        const q = await api<{ usd: number | null }>("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: detail.provider, id: detail.id, input }),
        });
        quotedUsd = q.usd ?? undefined;
      }
      const { jobId } = await api<{ jobId: string }>("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: detail.provider, id: detail.id, input }),
      });
      updateRun(run.id, { jobId, status: "queued", quotedUsd });
      setNotice(`Started ${detail.name}. It will appear in Results when ready.`);
    } catch (e) {
      updateRun(run.id, { status: "failed", error: (e as Error).message, finishedAt: Date.now() });
      setFormErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  // ---------- poll running jobs ----------
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const hasPollable = runs.some((r) => r.jobId && POLLABLE.has(r.status));
  useEffect(() => {
    if (!hasPollable) return;
    let stopped = false;
    const tick = async () => {
      const active = runsRef.current.filter((r) => r.jobId && POLLABLE.has(r.status));
      await Promise.all(
        active.map(async (r) => {
          try {
            const j = await api<JobState>(`/api/jobs?provider=${r.provider}&id=${encodeURIComponent(r.jobId!)}`);
            if (stopped) return;
            const done = j.status === "completed" || j.status === "failed";
            updateRun(r.id, {
              status: j.status,
              videoUrl: j.videoUrl,
              error: j.error,
              costUsd: j.costUsd,
              runtimeS: j.runtimeS,
              ...(done ? { finishedAt: Date.now() } : {}),
            });
          } catch {
            // Network blip; try again next tick.
          }
        }),
      );
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [hasPollable, updateRun]);

  // ---------- reuse a past run ----------
  function reuse(r: Run) {
    pendingReuse.current = r;
    setProvider(r.provider);
    setPrompt(r.prompt);
    const k = keyOf(r.provider, r.modelId);
    setValuesByModel((all) => {
      const { [k]: _drop, ...rest } = all;
      return rest;
    });
    const summary = models[r.provider]?.find((m) => m.id === r.modelId) ?? {
      provider: r.provider, id: r.modelId, name: r.modelName, vendor: "", family: "", function: r.modelFunction, description: "",
    };
    setTab("generate");
    void selectModel(summary);
  }

  const runCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of runs) c[keyOf(r.provider, r.modelId)] = (c[keyOf(r.provider, r.modelId)] ?? 0) + 1;
    return c;
  }, [runs]);
  const activeCount = runs.filter((r) => ACTIVE.has(r.status)).length;

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </div>
            <span className="whitespace-nowrap font-semibold">Rample<span className="hidden sm:inline"> Model Lab</span></span>
          </div>
          <nav className="flex gap-1 rounded-lg bg-panel-2 p-1 text-sm" aria-label="Sections">
            {(["generate", "results"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition sm:px-3 ${tab === t ? "bg-panel shadow-sm" : "text-muted hover:text-fg"}`}
              >
                {t === "generate" ? "Generate" : `Results${runs.length ? ` (${runs.length})` : ""}`}
                {t === "results" && activeCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-accent-fg">{activeCount}</span>
                )}
              </button>
            ))}
          </nav>
          <button onClick={signOut} className="ml-auto whitespace-nowrap text-sm text-muted hover:text-fg">Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {tab === "generate" ? (
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="h-[60vh] lg:sticky lg:top-[68px] lg:row-span-2 lg:h-[calc(100vh-88px)] xl:row-span-1">
              <ModelPicker
                provider={provider}
                onProvider={setProvider}
                models={models}
                loadError={loadError}
                selectedId={selected?.provider === provider ? selected.id : null}
                onSelect={selectModel}
                runCounts={runCounts}
              />
            </div>
            <InputsPanel
              assets={assets}
              onAddFiles={addFiles}
              onRemove={removeAsset}
              onEditText={(id, text) => setAssets((as) => as.map((a) => (a.id === id ? { ...a, text } : a)))}
              rejected={rejected}
              prompt={prompt}
              onPrompt={setPrompt}
              promptMaxLength={promptField?.maxLength}
              hasPromptField={!detail || !!promptField}
              onDraft={draftPrompt}
              drafting={drafting}
              draftError={draftError}
              onUndoDraft={preDraftPrompt !== null ? () => { setPrompt(preDraftPrompt); setPreDraftPrompt(null); } : null}
            />
            <div className="flex flex-col gap-3">
              <ModelForm
                model={detail}
                loading={detailLoading}
                error={detailError}
                fields={fields}
                values={values}
                onValue={(name, v) => setValues({ ...values, [name]: v })}
                assets={assets}
                quote={quote}
                onGenerate={generate}
                busy={busy}
                formErrors={formErrors}
              />
              {notice && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-accent-soft px-4 py-2 text-sm">
                  <span>{notice}</span>
                  <button onClick={() => setTab("results")} className="shrink-0 font-medium text-accent hover:underline">View results →</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Results
            runs={runs}
            onUpdate={updateRun}
            onDelete={(id) => setRuns((rs) => rs.filter((r) => r.id !== id))}
            onReuse={reuse}
            onClearAll={() => setRuns([])}
          />
        )}
      </main>
    </div>
  );
}
