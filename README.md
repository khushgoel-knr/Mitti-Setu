# Mitti Setu

Farmer-to-buyer marketplace created by Sherlock Homies for SRM AP Sociothon. This edition targets GitHub + Vercel, using Next.js and a hosted Turso **libSQL** database.

## First deployment

1. Import `khushgoel-knr/Mitti-Setu` at https://vercel.com/new using your GitHub account. Use the Next.js preset, repository root `./`, Node.js 24.x and the default commands. Do not change Output Directory.
2. Create a Turso libSQL database at https://app.turso.tech (choose libSQL if asked for an engine). Copy its database URL and create a database access token. Turso also offers a Vercel integration: https://docs.turso.tech/integrations/vercel .
3. In the Vercel project's Environment Variables, add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for Production. Paste each real value there, never in source code or chat. Use a separate database for Preview deployments if you enable them.
4. Deploy, or redeploy after adding/changing variables. The build prepares database migrations and twelve clearly labelled sample listings. Open `/api/health` on the new site: it should return `{"ok":true,"database":true}`. Then test signup, login, adding a crop, sending an offer, and confirming acceptance with separate test accounts.
5. GitHub stores your source. Vercel builds and hosts it; pushes to the production branch trigger a new deployment. The database persists separately in Turso.

The optional `GEMINI_API_KEY` from Google AI Studio enables crop-photo assessments. Set `GEMINI_MODEL` to an available image-capable model (default `gemini-3.5-flash-lite`). Store keys in Vercel environment variables, never browser code. Google free-tier quota limits apply and free-tier inputs may be used to improve Google services; the upload page discloses this. `PLANT_ID_API_KEY` remains supported as an alternative when Gemini is not configured. Guided crop care works without it. Do not set this to a made-up key.

## Marketplace assistant

The existing server-only `GEMINI_API_KEY` also powers smart marketplace search, crop-description translation and voice/text listing drafts. No extra key or paid billing is enabled. These calls share model quota; ordinary search and manual listing forms remain available on failure.

- Smart search extracts bounded filters and applies them to live database inventory. Locations match listing text; there is no distance/geolocation search.
- Farmers can record until they choose Stop, listen locally and explicitly send the audio to fill an editable listing form. Long recordings are split into independent parts, converted to mono 16 kHz WAV, sent sequentially only on request and not stored by Mitti Setu. The farmer must review and save. Unknown fields are left unchanged; quality is never inferred by the assistant.
- Listing details keep the original description alongside an optional English/Hindi/Telugu translation. Translations that change numeric tokens are rejected. Translation caches are bounded and keyed by source text/language.
- Public AI endpoints are rate limited; drafting requires a farmer session. Text/audio sent to Google uses the existing free-tier data disclosure. No keys reach the browser. Real microphone and language accuracy depend on the user's browser, speech and background noise.

## Local development of this edition

Install Node.js 24, then run `npm ci`. Copy `.env.example` to `.env.local`. For a disposable local database set `TURSO_DATABASE_URL=file:.test-data/local.sqlite` and leave `TURSO_AUTH_TOKEN` blank; create `.test-data` first. Run `npm run dev` and open http://localhost:3000. Use real Turso values only when deliberately connecting to that database.

`npm test` checks schema migrations, image blobs, atomic stock changes, ratings, crop analysis and marketplace assistant extraction, filtering, translations, permissions and failures. `npm run build` checks the production bundle. For an end-to-end local check run `TEST_ORIGIN=http://127.0.0.1:3000 node tests/cloud-smoke.mjs` (set the environment variable using your shell's syntax). This creates local-only test accounts; do not point it at production.

## Data and deployment notes

- New and edited crops require a farmer-declared quality score (integer 0–100), cultivation date and harvest date. Dates cannot be in the future; harvest cannot precede cultivation. Historical missing dates remain unknown.
- Existing active listings without quality receive a one-time price-based estimate (60–90) ranked within the same crop kind and category, or 75 when no comparison exists. This is explicitly labelled and is not a quality inspection or certification.
- Seller trust is the average buyer rating (0–5). Buyers can rate directly from marketplace cards, with one editable rating per buyer/farmer pair across all crops. Purchases are not verified. Existing offer reviews migrate to the latest review per buyer/farmer. Existing registered farmers receive a stable random starter score clearly labelled Demo rating, kept separately from reviews and replaced in the UI by any real buyer feedback. No fake buyers or review counts are created; future farmers start unrated.
- This is a fresh database deployment. Existing Cloudflare and Desktop accounts/data are not automatically transferred. The original online site and offline Desktop edition remain independent.
- `.env*`, database files, node_modules, build files and tests' saved data are excluded by .gitignore. Only `.env.example` contains placeholder configuration.
- Password hashes and session tokens are private; listing names, seller names and photos are public. No email verification, password recovery, payment processing or delivery booking is integrated yet.
- Uploaded listing images are limited to 1.5 MB. They are stored in the database in this prototype.
- The initial migration is schema-only and recorded once in `mitti_migrations`. Add versioned migrations rather than modifying an applied schema for future changes.
- The production runtime requires a remote database. Vercel cannot use this project's local SQLite file as persistent storage.
- The production bundle does not contain local user accounts or API keys. Check repository visibility and keep it private if that is your intended audience for the source.

For fully offline use, continue using the separate Desktop/Mitti Setu folder and its `Start Mitti Setu.cmd` launcher.

## Crop Monitor

`/#monitor` adds private, farmer-owned farm profiles with crop, sowing date, area/unit, irrigation method, soil type and confirmed Indian town coordinates. Migration 006 stores profiles, check-ins and timestamped guidance. Farm data is never included in public marketplace state.

Open-Meteo / GeoNames supplies location search and regional weather, cached for 15 minutes. Surface soil moisture (0–1 cm, m³/m³) is labelled as a model estimate. Farmer-entered moisture (%), health, stage and irrigation remain separate and dated; no sensor readings or health scores are fabricated. The public example is explicitly labelled and uses weather for Guntur. Weather refreshes while the page is visible; no background irrigation automation or field sensors are connected.

Farmers can save observations, see seven-day rain/temperature forecasts, and request Gemini next-step guidance. The guidance receives only profile facts, recent observations and available weather, is saved with its source timestamps, and is marked outdated after a new observation/profile change. Archive preserves history.

Both listing and monitoring voice forms have no fixed total recording cutoff. Independent 20-second recording parts keep individual serverless requests small; device memory, network connectivity and provider quotas still apply. Completed analysis parts are retained for retries. Microphone tracks stop on user Stop, dialog close or navigation; raw audio stays local until Fill form and is never stored in this application's database.
