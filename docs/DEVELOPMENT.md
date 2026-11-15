# LifeFlow — Local Development Guide

## OneDrive interference with the dev server

**Symptom:** `The directory at ".next/dev" was deleted` while `npm run dev` is running.
Turbopack rebuilds, then immediately reports the cache directory was deleted again.
This manifests as broken hot-reload, missing CSS, and intermittent compile errors.

**Root cause:** This project lives inside `C:\Users\…\OneDrive\Documents\LifeFlow`.
OneDrive's file-sync process continuously reads and sometimes removes temporary files
inside `.next/dev` while Turbopack is writing them, causing the race condition.

**Fixes (choose one):**

### Option A — Exclude `.next` from OneDrive sync (recommended)

1. Open **OneDrive Settings** → **Backup** → **Manage backup**,  
   *or* right-click the OneDrive tray icon → **Settings**.
2. Under **Account** → **Choose folders**, uncheck the LifeFlow project folder,
   then re-check it but exclude the `.next` sub-folder.
3. Alternatively, in OneDrive's **Files On-Demand** settings, pause sync while
   developing and resume when you need a backup.

### Option B — Pause OneDrive during development

Right-click the OneDrive tray icon → **Pause syncing** → **2 hours** (or 24 hours).
Resume when you push your work.

### Option C — Move the project outside OneDrive (most reliable)

```powershell
# Stop the dev server first, then:
Move-Item "C:\Users\<you>\OneDrive\Documents\LifeFlow" "C:\dev\LifeFlow"
cd "C:\dev\LifeFlow"
npm run dev
```

After moving, update any IDE workspace settings that reference the old path.

### Option D — Use a junction point (advanced)

Keep the source in OneDrive for backup, but redirect `.next` to a local drive:

```powershell
# Run once after cloning / moving:
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
New-Item -ItemType Junction -Path .next -Target "C:\dev\lifeflow-next-cache"
```

This keeps `.next` on a local (non-synced) path while the source code remains
in OneDrive. The junction is transparent to Next.js and npm.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values before running.

Required:
- `MONGODB_URI` — MongoDB Atlas connection string
- `SESSION_SECRET` — at least 32 characters (generate: `openssl rand -base64 32`)

---

## Running the dev server

```powershell
npm run dev
```

Navigate to http://localhost:3000.

If you see MongoDB connection errors, ensure your current IP address is in the
Atlas cluster's IP Allowlist (Network Access tab in the Atlas dashboard).

---

## Test suite

```powershell
npm test           # single run
npm run test:watch # watch mode
```

Note: `mongodb-memory-server` may time out on first run while it downloads
the MongoDB binary. Set `MONGOMS_VERSION=7.0.14` in your environment if the
download repeatedly fails.

---

## TypeScript check

```powershell
npm run typecheck
```

---

## Production build (local)

```powershell
npm run build
npm start
```

The build requires all environment variables to be set. Use `.env.local` for
local builds. Docker builds use build-time ARGs — see `Dockerfile`.
