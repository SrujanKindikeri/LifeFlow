# LifeFlow

A personal daily dashboard — tasks, habits, expenses, group bills, subscriptions, goals, notes, money tracker, and more. Built with Next.js 16, MongoDB Atlas, and iron-session.

---

## Quick start (local development)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd lifeflow
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — fill in MONGODB_URI and SESSION_SECRET at minimum

# 3. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Minimum `.env.local`

```env
MONGODB_URI=mongodb://localhost:27017/lifeflow
SESSION_SECRET=<generate: openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run typecheck` | TypeScript type check (no emit) |

---

## Environment variables

All configuration is via environment variables — no secrets are hard-coded.

Copy `.env.example` to `.env.local` and fill in values. The full reference with descriptions is in `.env.example`.

### Required (all platforms)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | iron-session encryption key (min 32 chars) — `openssl rand -base64 32` |

### Recommended

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Full URL of the app (no trailing slash) |
| `NEXT_PUBLIC_CURRENCY` | `INR` | Default currency code |
| `SCHEDULER_SECRET` | — | Protects `/api/jobs/process-subscriptions` — `openssl rand -base64 32` |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | IANA timezone for date calculations |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Never put these in `NEXT_PUBLIC_*` variables

`MONGODB_URI`, `SESSION_SECRET`, `SCHEDULER_SECRET`, `CRON_SECRET`, `STORAGE_SECRET_ACCESS_KEY`, `AZURE_STORAGE_ACCOUNT_KEY`, `GOOGLE_VISION_API_KEY`, `OCR_API_KEY`, `EMAIL_API_KEY`, `SMTP_PASS`

---

## Storage

Transaction screenshots can be stored in three ways. Set `STORAGE_PROVIDER` to choose.

| Provider | `STORAGE_PROVIDER` | Requirements |
|---|---|---|
| MongoDB (default) | `mongodb` | None — stored as base64 in Atlas |
| AWS S3 | `s3` | `STORAGE_BUCKET`, `STORAGE_REGION`, optionally `STORAGE_ACCESS_KEY_ID` + `STORAGE_SECRET_ACCESS_KEY` |
| Azure Blob | `azure` | `AZURE_STORAGE_ACCOUNT_NAME`, optionally `AZURE_STORAGE_ACCOUNT_KEY` (or Managed Identity) |
| Local filesystem | `local` | **Development only** — throws at startup in production |

For S3 and Azure, install the optional SDK packages:
```bash
# S3
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
# Azure
npm install @azure/storage-blob @azure/identity
```

---

## OCR

Controls how transaction screenshots are analyzed when adding expenses.

| Setting | Description |
|---|---|
| `OCR_PROVIDER=auto` | Try Google Vision first (if key set), fall back to Tesseract (default) |
| `OCR_PROVIDER=google_vision` | Google Cloud Vision API only |
| `OCR_PROVIDER=tesseract` | Tesseract.js only (offline, no API key needed) |

Set `GOOGLE_VISION_API_KEY` for production-quality OCR. Get a key at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) (enable the Cloud Vision API).

---

## Subscription scheduler

LifeFlow automatically creates expense records for due subscriptions. A scheduler must periodically call:

```bash
POST /api/jobs/process-subscriptions
Authorization: Bearer <SCHEDULER_SECRET>
```

The endpoint is **idempotent** — safe to call as often as every 5 minutes.

| Platform | Setup |
|---|---|
| **Vercel** | `vercel.json` cron is already configured (runs hourly). Set `CRON_SECRET`. |
| **EC2 / Azure VM** | Use the systemd timer in the deployment docs, or crontab. |
| **AWS EventBridge** | Schedule an HTTP call every hour. |
| **External** | cron-job.org, Uptime Robot, or any HTTP scheduler. |

---

## Deployment

| Platform | Guide |
|---|---|
| Vercel | [docs/deployment-vercel.md](docs/deployment-vercel.md) |
| Azure VM | [docs/deployment-azure-vm.md](docs/deployment-azure-vm.md) |
| AWS EC2 | [docs/deployment-aws-ec2.md](docs/deployment-aws-ec2.md) |
| Production checklist | [docs/production-checklist.md](docs/production-checklist.md) |

---

## Docker

```bash
# Build
docker build -t lifeflow .

# Run (supply secrets at runtime — never bake into the image)
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/lifeflow" \
  -e SESSION_SECRET="your-32-char-secret" \
  -e SCHEDULER_SECRET="your-scheduler-secret" \
  -e NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  lifeflow

# With docker compose (loads from .env.local automatically)
docker compose up

# With a local MongoDB instance
docker compose --profile local-mongo up
```

The Docker image uses a **multi-stage build** (`deps → builder → runner`) and runs as a **non-root user** (uid 1001). The final image size is ~200–250 MB.

---

## Health checks

| Endpoint | Purpose | Success |
|---|---|---|
| `GET /api/health` | Full liveness + DB ping | HTTP 200, `"status":"ok"` |
| `GET /api/ready` | Readiness (env vars only, no DB) | HTTP 200, `"status":"ready"` |

Example response:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-09-10T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600
}
```

Use `/api/health` for AWS ALB, Azure health probes, Docker `HEALTHCHECK`, and Kubernetes liveness probes.

---

## Architecture

```
Browser
  ↓  HTTPS
NGINX / Vercel / ALB  (TLS termination)
  ↓
Next.js 16 App Router  (standalone Node.js server)
  ├── Server Components  (data fetching)
  ├── Client Components  ('use client' — UI interactions)
  ├── API Routes         (/api/*  — REST endpoints)
  └── Middleware         (proxy.ts — auth guard, redirects)
  ↓
MongoDB Atlas  (database + optional file storage)
  ↓  (optional)
AWS S3 / Azure Blob  (transaction proof images)
  ↓  (optional)
Google Cloud Vision / Tesseract.js  (OCR)
```

---

## Security notes

- Sessions are encrypted with `iron-session` (AES-GCM), stored in HTTP-only `Secure` cookies.
- All API routes derive `userId` from the server-side session — never from request bodies.
- MongoDB queries always include `userId` for ownership enforcement.
- The scheduler endpoint (`/api/jobs/process-subscriptions`) requires `Authorization: Bearer <secret>`.
- OCR raw text is never logged or returned in API responses.
- `STORAGE_PROVIDER=local` is blocked at startup in `NODE_ENV=production`.
- Security headers (CSP, HSTS, X-Frame-Options, etc.) are set in `next.config.ts`.
