# Digi Janseva · Doctor Portal

The Doctor Portal as a standalone Vite project (plain JavaScript, no UI framework),
connected to your **existing** Doctor Supabase project. The design, layout, theme and
features are unchanged from the preview. See `docs/CHANGES_FROM_PREVIEW.md` for the full
list of code changes.

> **Status: not yet tested against your Supabase project.** The code is written to read
> your data under the signed-in doctor's session and your Row-Level Security policies,
> but nobody has run it against your database yet. The portal itself only says
> "Connected to Supabase" (Settings page) after a real data load succeeds.

## Stack

- Plain JavaScript (ES modules), CSS, no framework
- [Vite](https://vite.dev) 5 for dev server and build
- `@supabase/supabase-js` 2.x
- Fonts (Figtree, Sora) from Google Fonts, as in the preview

## Project structure

```
digi-janseva-doctor-portal/
├─ index.html                 page shell + icon sprite (unchanged markup)
├─ package.json
├─ vite.config.js
├─ .env.example               placeholders only
├─ .gitignore                 keeps .env files out of git
├─ src/
│  ├─ main.js                 the portal (views, actions, data layer)
│  ├─ supabaseClient.js       Supabase client from env vars + key safety checks
│  └─ styles.css              the premium dark theme (byte-identical to the preview)
└─ docs/
   ├─ EXPECTED_SUPABASE_SCHEMA.md   what the app reads/writes + RLS checklist
   └─ CHANGES_FROM_PREVIEW.md       every change made when extracting the preview
```

## 1. Install

Requires Node.js 18 or newer.

```bash
cd digi-janseva-doctor-portal
npm install
```

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with values from your existing Doctor project
(Supabase dashboard → Project Settings → API):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your public anon / publishable key>
```

- Use only the **anon / publishable** key. Never use the `service_role` / secret key.
  Everything prefixed `VITE_` is shipped to every browser. The client refuses to start
  if it detects a secret or service-role key.
- Do not commit `.env.local` (already in `.gitignore`).

## 3. Run locally

```bash
npm run dev
```

Open http://localhost:5173. With no env vars you will see the "Backend not configured"
state (no data is shown). With valid env vars you will see a sign-in form. Sign in with
a doctor account that exists in your project.

## 4. Check the connection (do this before trusting it)

1. Sign in as a doctor. Settings → **Data connection** should say "Connected to Supabase".
   If loading fails, a persistent error card shows the real message.
2. Confirm the Dashboard, Queue, Appointments and Records show only that doctor's data.
3. Sign in as a **second doctor** and a **non-doctor** (patient) account:
   - the second doctor must not see the first doctor's patients or reports;
   - the patient account must see "This account is not a doctor account".
4. Approve a test report, change a priority, and cancel a test appointment, then check
   the rows in Supabase.

If step 3 shows data it shouldn't, fix your RLS policies before going live
(checklist in `docs/EXPECTED_SUPABASE_SCHEMA.md`).

## 5. Build and deploy

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve dist/ locally to check
```

`dist/` is a static site (the router uses `#/` hash URLs, so no server rewrites are needed).
Deploy it to Vercel, Netlify, Cloudflare Pages or any static host:

- Build command: `npm run build`; output directory: `dist`
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment settings
  (they are read at build time, so redeploy after changing them)
- In Supabase → Authentication → URL Configuration, add your deployed URL to the
  allowed Site URL / Redirect URLs
- Serve over HTTPS (also required for camera/microphone access)

## What this project does NOT include

- **A real patient-to-doctor video call.** The Video page has a local camera/microphone
  check and a waiting list. "Join" opens the consultation notes panel. There is no
  call connection to the patient (no WebRTC, Daily, Twilio, LiveKit, etc.). A provider
  and server-side token/room creation need to be added for real in-app consultations.
- **The AI backend.** The portal calls two Supabase Edge Functions that must already exist
  in your project: `summarize-patient-record` and `draft-medical-report`. No AI key is
  in the browser. If the functions are missing, the buttons show an error toast.
- **Database changes.** No tables, migrations or policies are created or altered.
- **Doctor verification onboarding.** The portal only signs in existing doctors and lets
  them approve AI report drafts. Verifying a new doctor's credentials must happen
  elsewhere in your system.
- **Alert sound and daily email summary.** These Settings toggles are stored on the
  device only and trigger nothing yet.
