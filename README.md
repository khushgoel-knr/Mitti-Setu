# Mitti Setu

Farmer-to-buyer marketplace created by Sherlock Homies for SRM AP Sociothon. This edition targets GitHub + Vercel, using Next.js and a hosted Turso **libSQL** database.

## First deployment

1. Import `khushgoel-knr/Mitti-Setu` at https://vercel.com/new using your GitHub account. Use the Next.js preset, repository root `./`, Node.js 24.x and the default commands. Do not change Output Directory.
2. Create a Turso libSQL database at https://app.turso.tech (choose libSQL if asked for an engine). Copy its database URL and create a database access token. Turso also offers a Vercel integration: https://docs.turso.tech/integrations/vercel .
3. In the Vercel project's Environment Variables, add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for Production. Paste each real value there, never in source code or chat. Use a separate database for Preview deployments if you enable them.
4. Deploy, or redeploy after adding/changing variables. The first API request creates the initial tables and twelve clearly labelled sample listings. Open `/api/health` on the new site: it should return `{"ok":true,"database":true}`. Then test signup, login, adding a crop, sending an offer, and confirming acceptance with separate test accounts.
5. GitHub stores your source. Vercel builds and hosts it; pushes to the production branch trigger a new deployment. The database persists separately in Turso.

The optional `PLANT_ID_API_KEY` enables Kindwise photo diagnosis when configured. Guided crop care works without it. Do not set this to a made-up key.

## Local development of this edition

Install Node.js 24, then run `npm ci`. Copy `.env.example` to `.env.local`. For a disposable local database set `TURSO_DATABASE_URL=file:.test-data/local.sqlite` and leave `TURSO_AUTH_TOKEN` blank; create `.test-data` first. Run `npm run dev` and open http://localhost:3000. Use real Turso values only when deliberately connecting to that database.

`npm test` checks idempotent schema creation, image blobs, atomic stock changes and batch rollback. `npm run build` checks the production bundle. For an end-to-end local check run `TEST_ORIGIN=http://127.0.0.1:3000 node tests/cloud-smoke.mjs` (set the environment variable using your shell's syntax). This creates local-only test accounts; do not point it at production.

## Data and deployment notes

- This is a fresh database deployment. Existing Cloudflare and Desktop accounts/data are not automatically transferred. The original online site and offline Desktop edition remain independent.
- `.env*`, database files, node_modules, build files and tests' saved data are excluded by .gitignore. Only `.env.example` contains placeholder configuration.
- Password hashes and session tokens are private; listing names, seller names and photos are public. No email verification, password recovery, payment processing or delivery booking is integrated yet.
- Uploaded listing images are limited to 1.5 MB. They are stored in the database in this prototype.
- The initial migration is schema-only and recorded once in `mitti_migrations`. Add versioned migrations rather than modifying an applied schema for future changes.
- The production runtime requires a remote database. Vercel cannot use this project's local SQLite file as persistent storage.
- The production bundle does not contain local user accounts or API keys. Check repository visibility and keep it private if that is your intended audience for the source.

For fully offline use, continue using the separate Desktop/Mitti Setu folder and its `Start Mitti Setu.cmd` launcher.
