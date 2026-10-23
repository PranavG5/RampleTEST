"use client";

import { useRef, useState } from "react";
import { formatBytes, type Asset } from "@/lib/extract";

interface Props {
  assets: Asset[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  rejected: string[];
  prompt: string;
  onPrompt: (p: string) => void;
  promptMaxLength?: number;
  hasPromptField: boolean;
  onDraft: () => void;
  drafting: boolean;
  draftError: string | null;
  onUndoDraft: (() => void) | null;
}

function KindBadge({ kind }: { kind: Asset["kind"] }) {
  const label = kind === "image" ? "Image" : kind === "video" ? "Video" : "Document";
  return <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>;
}

function AssetRow({ a, onRemove, onEditText }: { a: Asset; onRemove: () => void; onEditText: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-line p-2">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-panel-2">
          {a.kind === "image" && a.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.previewUrl} alt="" className="h-full w-full object-cover" />
          )}
          {a.kind === "video" && a.previewUrl && <video src={a.previewUrl} className="h-full w-full object-cover" muted />}
          {a.kind === "document" && (
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M14 3v6h6M8 13h8M8 17h5" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={a.name}>{a.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <KindBadge kind={a.kind} />
            <span>{formatBytes(a.size)}</span>
            {a.kind === "document" && a.extracting && <span>Reading…</span>}
            {a.kind === "document" && a.text !== undefined && (
              <button className="text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
                {a.text.length.toLocaleString()} chars {open ? "▴" : "▾"}
              </button>
            )}
            {a.textError && <span className="text-warn">{a.textError}</span>}
          </div>
        </div>
        <button onClick={onRemove} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg" aria-label={`Remove ${a.name}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {open && a.text !== undefined && (
        <textarea
          value={a.text}
          onChange={(e) => onEditText(e.target.value)}
          rows={8}
          className="mt-2 w-full rounded-md border border-line p-2 font-mono text-xs outline-none focus:border-accent"
          aria-label={`Extracted text from ${a.name}`}
        />
      )}
    </li>
  );
}

export default function InputsPanel(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const docCount = p.assets.filter((a) => a.kind === "document").length;
  const over = p.promptMaxLength !== undefined && p.prompt.length > p.promptMaxLength;

  function addPasted() {
    if (!pasteText.trim()) return;
    const n = p.assets.filter((a) => a.name.startsWith("Pasted text")).length + 1;
    p.onAddFiles([new File([pasteText], `Pasted text ${n}.txt`, { type: "text/plain" })]);
    setPasteText("");
    setPasteOpen(false);
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold">Inputs</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            p.onAddFiles([...e.dataTransfer.files]);
          }}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          role="button"
          tabIndex={0}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragging ? "border-accent bg-accent-soft" : "border-line hover:border-accent"
          }`}
        >
          <p className="text-sm font-medium">Drop anything here, or click to browse</p>
          <p className="mt-1 text-xs text-muted">
            Images and videos go to the model. PDFs, spreadsheets, Word, PowerPoint and text files are read for the prompt.
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              p.onAddFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button className="text-xs text-accent hover:underline" onClick={() => setPasteOpen((o) => !o)}>
            {pasteOpen ? "Cancel" : "+ Paste text as a document"}
          </button>
        </div>
        {pasteOpen && (
          <div className="mt-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder="Business info, a script, a brief…"
              className="w-full rounded-md border border-line p-2 text-sm outline-none focus:border-accent"
            />
            <button onClick={addPasted} className="mt-1 rounded-md bg-panel-2 px-3 py-1 text-xs font-medium hover:bg-line">
              Add
            </button>
          </div>
        )}
        {p.rejected.length > 0 && (
          <ul className="mt-2 text-xs text-warn">
            {p.rejected.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {p.assets.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {p.assets.map((a) => (
              <AssetRow key={a.id} a={a} onRemove={() => p.onRemove(a.id)} onEditText={(t) => p.onEditText(a.id, t)} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="prompt" className="text-sm font-semibold">Prompt</label>
          <span className={`text-xs ${over ? "text-bad" : "text-muted"}`}>
            {p.prompt.length.toLocaleString()}
            {p.promptMaxLength ? ` / ${p.promptMaxLength.toLocaleString()}` : ""} chars
          </span>
        </div>
        <textarea
          id="prompt"
          value={p.prompt}
          onChange={(e) => p.onPrompt(e.target.value)}
          rows={7}
          placeholder={p.hasPromptField ? "Describe the video. The same prompt carries over when you switch models, so comparisons stay fair." : "This model takes no text prompt."}
          className="w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={p.onDraft}
            disabled={p.drafting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-panel-2 disabled:opacity-60"
            title="Claude reads your documents and the text above, then writes a prompt for the selected model"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
            {p.drafting ? "Claude is writing…" : "Draft with Claude"}
          </button>
          {p.onUndoDraft && (
            <button onClick={p.onUndoDraft} className="text-xs text-muted hover:text-fg hover:underline">
              Undo draft
            </button>
          )}
          <span className="text-xs text-muted">
            {docCount > 0 ? `Uses ${docCount} document${docCount > 1 ? "s" : ""} + your text as the brief` : "Optional. Add documents for Claude to read."}
          </span>
        </div>
        {p.draftError && <p className="mt-2 text-xs text-bad">{p.draftError}</p>}
      </div>
    </section>
  );
}
