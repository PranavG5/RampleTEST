import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/server";

// Optional helper: Claude reads the uploaded documents and the tester's notes
// and drafts one prompt for the chosen video model. The tester can edit it
// before generating, and the video itself still comes from that one model.

export const maxDuration = 120;

interface Body {
  model?: { name?: string; function?: string; notes?: string[]; promptMaxLength?: number; mediaFields?: string[] };
  idea?: string;
  documents?: { name: string; text: string }[];
  mediaFiles?: { name: string; kind: string }[];
}

const SYSTEM = `You write prompts for AI video generation models. A UI/UX team uses you to test one video model at a time.

You get: the target model and what kind of model it is, the tester's own idea or notes, text pulled from files they uploaded (business info, spreadsheets, scripts, briefs), and the names of any images or videos that will be passed to the model as media inputs.

Write ONE prompt for that model. Rules:
- Describe a single short shot or sequence the model can actually render: subject, action, setting, camera movement, lighting, mood.
- Use concrete facts from the documents (business name, services, products, place) only where they help the visuals. Do not invent facts about the business.
- If images or videos are attached, describe motion and change rather than re-describing what the media already shows.
- Avoid on-screen text unless the tester asks for it; most video models render text badly.
- Avoid physically awkward actions (hands, people passing through objects, fast complex choreography).
- Respect the character limit if one is given.
- Reply with the prompt text only. No preamble, no quotes, no markdown.`;

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set. Add it in the Vercel project settings." }, { status: 500 });
    }
    const body = (await req.json()) as Body;
    const docs = (body.documents ?? []).filter((d) => d.text?.trim());
    const media = body.mediaFiles ?? [];
    const limit = body.model?.promptMaxLength;

    const parts: string[] = [
      `<target_model>\nName: ${body.model?.name ?? "unknown"}\nType: ${body.model?.function ?? "video generation"}` +
        (body.model?.mediaFields?.length ? `\nMedia inputs it accepts: ${body.model.mediaFields.join(", ")}` : "") +
        (body.model?.notes?.length ? `\nProvider usage notes:\n- ${body.model.notes.join("\n- ")}` : "") +
        (limit ? `\nPrompt character limit: ${limit}` : "") +
        `\n</target_model>`,
      `<tester_idea>\n${body.idea?.trim() || "(none given: pick the most compelling short ad shot the documents support)"}\n</tester_idea>`,
    ];
    if (media.length) {
      parts.push(`<attached_media>\n${media.map((m) => `- ${m.name} (${m.kind})`).join("\n")}\n</attached_media>`);
    }
    for (const d of docs) {
      parts.push(`<document name="${d.name.replace(/"/g, "'")}">\n${d.text}\n</document>`);
    }

    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "Claude declined to write this prompt. Try rewording your idea." }, { status: 422 });
    }
    const prompt = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return NextResponse.json({ prompt });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Anthropic rejected the API key" }, { status: 502 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Anthropic rate limit hit. Try again in a minute." }, { status: 429 });
    }
    if (e instanceof Anthropic.BadRequestError) {
      return NextResponse.json({ error: `Anthropic: ${e.message}` }, { status: 400 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic error ${e.status}: ${e.message}` }, { status: 502 });
    }
    return errorResponse(e);
  }
}
