# Rample Model Lab

An internal site for the UI/UX team to test **every Pika and Higgsfield video model, one model at a time**, and compare the results by hand.

- **Pick one model.** Pika's 78 video models come from Pika's live catalog. Higgsfield's 67 video workflows come from its docs. Each model's settings form is built from that model's own input schema, so new models work without code changes.
- **Drop in anything.** Images and videos go to the model as media inputs. PDFs, spreadsheets (.xlsx/.csv), Word (.docx), PowerPoint (.pptx) and text files are read in the browser, and their text can feed the prompt. Audio is turned off for now.
- **Optional Claude helper.** "Draft with Claude" reads the documents and your rough idea, then writes a prompt for the selected model. You can edit or undo it. The video itself always comes from the one model you picked.
- **Same prompt, many models.** The prompt stays put when you switch models, so comparisons are fair.
- **Results.** Every run is saved with its model, settings, time taken and cost. You can rate it 1 to 5, add notes, compare 2 to 6 videos side by side with synced playback, reuse its settings, and export everything to CSV.
- **Cost check.** Pika runs show the exact price before you click Generate, using Pika's free quote endpoint. Higgsfield doesn't publish per-request prices.
- **Sign-in.** One hardcoded account: `test@rample.ai` / `baxatest`.

## Deploy on Vercel

1. Import this repo in Vercel. It auto-detects Next.js, so no build settings are needed.
2. Add these environment variables (Project → Settings → Environment Variables):

   | Variable | What it is |
   | --- | --- |
   | `PIKA_API_KEY` | Pika API key (dev.pika.art) |
   | `HIGGSFIELD_API_KEY` | Higgsfield credential written as `key-id:secret` (both parts from console.higgsfield.ai, joined by a colon) |
   | `ANTHROPIC_API_KEY` | Only needed for "Draft with Claude" |

   Optional: `AUTH_SECRET` (any long random string) signs the login cookie. If it's left out, the keys above are used to sign it instead. `HIGGSFIELD_API_KEY_ID` + `HIGGSFIELD_API_KEY_SECRET` also work in place of `HIGGSFIELD_API_KEY`.

3. Deploy. API keys stay on the server and never reach the browser.

## Run locally

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev                  # http://localhost:3000
```

## Keeping the model list current

- **Pika:** nothing to do. The catalog is fetched live and cached for an hour.
- **Higgsfield:** it has no public list of all models, so `data/higgsfield-models.json` is built from its docs. Refresh it with:

  ```bash
  npm run sync:higgsfield
  ```

  Then commit the updated JSON.

## How it works

```
app/page.tsx              main screen: model picker, inputs, settings, results
app/api/models            model lists + per-model input schema
app/api/quote             Pika price quote (free)
app/api/upload            presigned upload URL from the provider (browser uploads directly)
app/api/upload/proxy      fallback upload through the server (4 MB max on Vercel)
app/api/generate          submit a job to the chosen model
app/api/jobs              poll job status
app/api/prompt            optional Claude prompt draft
lib/schema.ts             JSON Schema → form fields
lib/providers/*           Pika + Higgsfield API clients
lib/history.ts            run history (browser storage for now)
proxy.ts                  login gate for every page and API route
scripts/sync-higgsfield.mjs  rebuilds the Higgsfield model list
```

Uploads go straight from the browser to the provider's storage through a presigned URL, so large videos never pass through Vercel's 4.5 MB request limit. If a provider's storage blocks browser uploads (CORS), the app falls back to uploading through the server, and that fallback works only for files under 4 MB.

## Known limits

- **Run history is per browser.** Results live in that browser's local storage and are not shared across the team. Use Export CSV to share them. This is the first thing to move to Supabase (see below).
- Some advanced fields (Kling multi-shot prompts, Kling Omni "contents", Pika compose tracks) use a JSON editor with an "Insert example" button. Inside them, write `"@file:photo.jpg"` to use an uploaded file. It is uploaded and swapped for its URL when you click Generate.
- Higgsfield accepts JPEG, PNG, WEBP and GIF images and MP4 video only. Pika caps uploads at 20 MB for images and 50 MB for video.
- Provider output URLs expire (Higgsfield keeps them for at least 7 days). Download any video you want to keep.

## Supabase (next step)

Planned tables:

- `client_profiles`: business name, industry, brand notes, uploaded asset URLs. The Inputs panel would load a profile instead of re-uploading the same files every time.
- `runs`: the `Run` type in `lib/types.ts`. Swap the three functions in `lib/history.ts` (`loadRuns`, `saveRuns`, `runsToCsv`) for Supabase calls, and the whole team shares results.
- Storage bucket: copy finished videos there so they outlive the providers' expiring URLs.
