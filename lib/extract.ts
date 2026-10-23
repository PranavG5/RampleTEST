// Browser-side file handling: sort any dropped file into media (sent to the
// video model) or a document (text pulled out for the prompt / Claude).

export type AssetKind = "image" | "video" | "document";

export interface Asset {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  kind: AssetKind;
  previewUrl?: string;
  text?: string;
  textError?: string;
  extracting?: boolean;
  // Public URL per provider once uploaded, so re-runs don't upload again.
  hosted: Partial<Record<"pika" | "higgsfield", string>>;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|rtf|yaml|yml|log|srt|vtt)$/i;

export function classify(file: File): AssetKind | "audio" {
  const t = file.type;
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) return "video";
  if (t.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return "audio";
  return "document";
}

export function makeAsset(file: File): Asset | { rejected: string } {
  const kind = classify(file);
  if (kind === "audio") return { rejected: `${file.name}: audio files aren't supported yet` };
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    type: file.type || guessType(file.name),
    kind,
    previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined,
    hosted: {},
  };
}

function guessType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function looksTextual(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  return !head.includes(0);
}

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await pdfText(pdf, { mergePages: true });
    return text.trim();
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.trim();
  }

  if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets
      .map((s) => `## Sheet: ${s.sheet}\n` + s.data.map((row) => row.map(cellText).join(" | ")).join("\n"))
      .join("\n\n")
      .trim();
  }

  if (name.endsWith(".pptx")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const slides = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const out: string[] = [];
    for (const [i, p] of slides.entries()) {
      const xml = await zip.files[p].async("string");
      const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      out.push(`## Slide ${i + 1}\n${runs.join(" ")}`);
    }
    return out.join("\n\n").trim();
  }

  if (/\.(xls|doc|ppt|key|pages|numbers)$/.test(name)) {
    throw new Error("Older Office / Apple formats can't be read in the browser. Save as .xlsx, .docx, .pptx or PDF.");
  }

  if (TEXT_EXT.test(name) || file.type.startsWith("text/") || (file.size < 5_000_000 && (await looksTextual(file)))) {
    const raw = await file.text();
    return /\.html?$/.test(name) ? stripHtml(raw) : raw.trim();
  }

  throw new Error("Can't read text from this file type. Its name is still shared with Claude.");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
