# Rample Model Lab

An internal site for the UI/UX team to test **every Pika and Higgsfield video model, one model at a time**, and compare the results by hand.

- **Pick one model.** Pika's 78 video models come from Pika's live catalog. Higgsfield's 67 video workflows come from its docs. Each model's settings form is built from that model's own input schema, so new models work without code changes.
- **Drop in anything.** Images and videos go to the model as media inputs. PDFs, spreadsheets (.xlsx/.csv), Word (.docx), PowerPoint (.pptx) and text files are read in the browser, and their text can feed the prompt. Audio is turned off for now.
- **Optional Claude helper.** "Draft with Claude" reads the documents and your rough idea, then writes a prompt for the selected model. You can edit or undo it. The video itself always comes from the one model you picked.
- **Same prompt, many models.** The prompt stays put when you switch models, so comparisons are fair.
- **Results, shared by the team.** Every run is saved to Supabase with its model, settings, status history, time taken and cost, and the finished video is copied into a private Supabase Storage bucket so it outlives the provider's expiring link. You can rate it 1 to 5, add notes, compare 2 to 6 videos side by side with synced playback, reuse its settings, and export everything to CSV.
- **Cost check.** Pika runs show the exact price before you click Generate, using Pika's free quote endpoint. Higgsfield doesn't publish per-request prices.
- **Sign-in.** Supabase Auth, email and password. Sign-ups are off; the team account is created with `npm run create-user`.

## Set up Supabase (once)

1. **Create the project.** At [supabase.com/dashboard](https://supabase.com/dashboard), create a new project (any name, a strong database password, the region closest to your Vercel region). The Free plan works; it caps each stored video at 50 MB.
2. **Copy three values** from **Project Settings → API Keys** (and the project URL from **Project Settings → Data API**, or the Connect button):
   - Project URL → `SUPABASE_URL` (looks like `https://abcd1234.supabase.co`)
   - Publishable key (`sb_publishable_...`) → `SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_...`) → `SUPABASE_SECRET_KEY`. **Server only:** never put it in client code or give it a `NEXT_PUBLIC_` prefix.
3. **Create the tables, policies and bucket.** Either:
   - **Supabase CLI** (installed with `npm install`): `npx supabase login`, `npx supabase link --project-ref <your-ref>`, then `npm run db:push`. Or:
   - **SQL Editor:** paste and run `supabase/migrations/20261026000001_runs.sql`, then `supabase/migrations/20261026000002_videos_bucket.sql`.
4. **Turn off sign-ups:** **Authentication → Sign In / Providers →** switch off **Allow new users to sign up**. Leave the **Email** provider itself on (turning it off disables sign-in too).
5. **Create the team login** (put the URL and secret key in `.env.local` first):

   ```bash
   RAMPLE_USER_EMAIL=you@example.com RAMPLE_USER_PASSWORD='...' npm run create-user
   ```

   Running it again for the same email resets the password.

## Deploy on Vercel

1. Import this repo in Vercel. It auto-detects Next.js, so no build settings are needed.
2. Add these environment variables (Project → Settings → Environment Variables):

   | Variable | What it is |
   | --- | --- |
   | `PIKA_API_KEY` | Pika API key (dev.pika.art) |
   | `HIGGSFIELD_API_KEY` | Higgsfield credential written as `key-id:secret` (both parts from console.higgsfield.ai, joined by a colon) |
   | `ANTHROPIC_API_KEY` | Only needed for "Draft with Claude" |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_...`) |
   | `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_...`), server only |
   | `VIDEO_MAX_MB` | Optional, default 50. Raise it only on a paid plan, together with the bucket's size limit |

   Also connect a **Vercel Blob** store (Project → Storage → Create Database → Blob → connect to this project, then redeploy). Pika's storage only accepts browser uploads from Pika's own site, so Pika inputs are uploaded to Blob and Pika reads them from there. Without it, Pika uploads are limited to 4 MB. Higgsfield uploads don't need it.

   `HIGGSFIELD_API_KEY_ID` + `HIGGSFIELD_API_KEY_SECRET` also work in place of `HIGGSFIELD_API_KEY`. The legacy Supabase `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` work in place of the publishable / secret keys.

3. Deploy. API keys (Supabase's included) stay on the server and never reach the browser.

## Run locally

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev                  # http://localhost:3000
```

To run against a local Supabase instead of the cloud project (needs Docker): `npx supabase start` applies the migrations and prints a local URL and keys for `.env.local`; then run `npm run create-user` against it.

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
app/api/upload/blob       Vercel Blob upload tokens (used for Pika inputs)
app/api/upload/proxy      fallback upload through the server (4 MB max on Vercel)
app/api/runs              team run history (list, create, rate/notes, soft delete)
app/api/runs/[id]/video   short-lived signed URL for a stored video
app/api/runs/[id]/archive "Retry save" for a video copy that failed
app/api/generate          submit a saved run to its model
app/api/jobs              poll one run's job, save status changes, start the video copy
app/api/prompt            optional Claude prompt draft
lib/db/*                  the only code that talks to Supabase (auth, runs, storage, video copy)
lib/pipeline.ts           run lifecycle: submit, poll, copy the video into Storage
lib/schema.ts             JSON Schema → form fields
lib/providers/*           Pika + Higgsfield API clients
lib/history.ts            browser side of run history (API calls + localStorage cache)
lib/videoCache.ts         browser cache of watched videos (Cache API, ~1 GB)
proxy.ts                  login gate for every page and API route, refreshes the Supabase session
supabase/migrations/*     tables, RLS policies, the private "videos" bucket
scripts/create-user.mjs   creates the team's Supabase login
scripts/sync-higgsfield.mjs  rebuilds the Higgsfield model list
```

### Where data lives

- **Supabase Postgres is the source of truth.** `runs` has one row per generation (model, prompt, full request body, quote, cost, job id, status, output video, rating, notes). `run_events` is its status history, written by a trigger on every status change. `run_inputs` lists the images/videos sent to the model. Deleting a run hides it (`deleted_at`); the row and video stay.
- **Videos** are copied from the provider into the private `videos` bucket (`runs/{run_id}/output.mp4`) in the background as soon as a job finishes. Files over 6 MB use resumable (TUS) uploads. If a copy fails, the run keeps the provider's URL (which still plays), and the copy is retried with backoff up to 5 times, then offered as "Retry save". Videos are only ever served through signed URLs that expire after 10 minutes.
- **Local cache.** The browser keeps the run list in localStorage (shown instantly, then refreshed from Supabase every 20 s) and keeps each video it has played in the Cache API, so re-watching doesn't download again. Signing out clears both.
- **Access.** Every signed-in user can read and change every run and video (one shared team workspace). Anonymous requests get nothing, at the API and at the database (RLS).

Uploads go straight from the browser to storage, so large videos never pass through Vercel's 4.5 MB request limit. Higgsfield inputs go to Higgsfield's own storage through a presigned URL. Pika's storage blocks browser uploads from other sites (CORS), so Pika inputs go to the project's Vercel Blob store (`app/api/upload/blob`) and Pika reads the public Blob URL. If no Blob store is connected, the app uploads through the server instead, which works only for files under 4 MB.

## Known limits

- Job status only moves forward while someone has the app open (the browser drives polling). A run left with no open tab finishes the next time anyone opens the app.
- Some advanced fields (Kling multi-shot prompts, Kling Omni "contents", Pika compose tracks) use a JSON editor with an "Insert example" button. Inside them, write `"@file:photo.jpg"` to use an uploaded file. It is uploaded and swapped for its URL when you click Generate.
- Higgsfield accepts JPEG, PNG, WEBP and GIF images and MP4 video only. Pika caps uploads at 20 MB for images and 50 MB for video.
- Provider output URLs expire (Higgsfield keeps them for at least 7 days). Finished videos are copied into Supabase Storage automatically; one that failed to copy shows "Retry save" in Results.

## Not in Supabase yet

- `client_profiles` (business name, industry, brand notes, reusable uploads) so the Inputs panel can load a profile instead of re-uploading the same files.
- Input images/videos still go to Vercel Blob (Pika) or Higgsfield's storage; only their names, sizes and URLs are saved on the run.
