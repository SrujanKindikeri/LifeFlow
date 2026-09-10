# LifeFlow

A personal daily dashboard — tasks, habits, expenses, group bills, subscriptions, goals, notes, money tracker, and more. Built with Next.js, MongoDB Atlas, and iron-session.

---

## Table of Contents

1. [Local Development](#1-local-development)
2. [MongoDB Atlas Setup](#2-mongodb-atlas-setup)
3. [Environment Variables](#3-environment-variables)
4. [Storage Configuration](#4-storage-configuration)
5. [OCR Configuration](#5-ocr-configuration)
6. [Subscription Cron Setup](#6-subscription-cron-setup)
7. [Vercel Deployment](#7-vercel-deployment)
8. [AWS Deployment](#8-aws-deployment)
9. [Azure Deployment](#9-azure-deployment)
10. [Docker](#10-docker)
11. [Health Checks](#11-health-checks)
12. [Email / Notifications](#12-email--notifications)
13. [Production Checklist](#13-production-checklist)

---

## 1. Local Development

### Prerequisites

- Node.js 20+
- npm 10+
- A MongoDB instance (local or Atlas)

### Setup

```bash
# Clone and install
git clone <your-repo-url>
cd lifeflow
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local — fill in MONGODB_URI and SESSION_SECRET at minimum

# Start dev server
npm run dev
```

The application will be available at `http://localhost:3000`.

### Minimum required `.env.local`

```env
MONGODB_URI=mongodb://localhost:27017/lifeflow
SESSION_SECRET=<generate with: openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### With Docker (local)

```bash
# Start app + local MongoDB
docker compose --profile local-mongo up

# Or use your own Atlas URI (no local MongoDB needed)
# Set MONGODB_URI in .env.local first, then:
docker compose up
```

---

## 2. MongoDB Atlas Setup

1. Create a free account at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a new cluster (M0 Free Tier is fine to start)
3. Under **Database Access** → Add a database user with a strong password
4. Under **Network Access** → Add IP address:
   - For Vercel/AWS/Azure: add `0.0.0.0/0` (allow all) — then lock down per-provider later
   - For local dev: add your current IP
5. Click **Connect** → **Connect your application** → copy the connection string
6. Replace `<password>` in the string with your database user's password
7. Set it as `MONGODB_URI` in your environment

Example URI:
```
mongodb+srv://myuser:mypassword@cluster0.abc123.mongodb.net/lifeflow?retryWrites=true&w=majority
```

---

## 3. Environment Variables

All configuration is via environment variables. No secrets are hard-coded.

Copy `.env.example` to `.env.local` and fill in values. The full reference is in `.env.example`.

### Required (all platforms)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | iron-session encryption key (min 32 chars). Generate: `openssl rand -base64 32` |

### Recommended

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Full URL of the app |
| `NEXT_PUBLIC_CURRENCY` | `INR` | Default currency |
| `SCHEDULER_SECRET` | — | Protects `/api/jobs/process-subscriptions`. Generate: `openssl rand -base64 32` |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | Default timezone for date calculations |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Never expose these to the browser

`MONGODB_URI`, `SESSION_SECRET`, `SCHEDULER_SECRET`, `CRON_SECRET`, `STORAGE_SECRET_ACCESS_KEY`, `AZURE_STORAGE_ACCOUNT_KEY`, `GOOGLE_VISION_API_KEY`, `OCR_API_KEY`, `EMAIL_API_KEY`, `SMTP_PASS`

---

## 4. Storage Configuration

Transaction screenshots can be stored in three ways. Set `STORAGE_PROVIDER` to choose.

### `STORAGE_PROVIDER=mongodb` (default)

Images stored as base64 inside MongoDB `TransactionProof` documents. Zero extra setup. Good for up to ~10,000 receipts. No additional environment variables needed.

### `STORAGE_PROVIDER=s3` (recommended for production)

Requires the AWS SDK packages:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Environment variables:
```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=my-lifeflow-proofs
STORAGE_REGION=ap-south-1
# Leave blank to use IAM role credentials (recommended on AWS ECS/App Runner)
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
# For S3-compatible stores (Cloudflare R2, MinIO):
STORAGE_ENDPOINT=https://xxx.r2.cloudflarestorage.com
```

**S3 bucket setup:**
1. Create a private S3 bucket (block all public access)
2. Enable server-side encryption (AES-256)
3. On AWS ECS/App Runner: attach an IAM role with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on your bucket

### `STORAGE_PROVIDER=azure` (for Azure deployments)

Requires the Azure SDK packages:
```bash
npm install @azure/storage-blob
# For Managed Identity:
npm install @azure/identity
```

Environment variables:
```env
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT_NAME=mylifeflowestorage
AZURE_STORAGE_CONTAINER=transaction-proofs
# Leave blank to use Managed Identity (recommended on Azure App Service / Container Apps)
AZURE_STORAGE_ACCOUNT_KEY=
```

**Azure setup:**
1. Create a Storage Account (Standard LRS or GRS)
2. Create a private Blob container named `transaction-proofs` (or set `AZURE_STORAGE_CONTAINER`)
3. On Azure App Service / Container Apps: enable Managed Identity and grant `Storage Blob Data Contributor` role

---

## 5. OCR Configuration

Controls how transaction screenshots are analyzed.

```env
OCR_PROVIDER=auto   # auto | google_vision | tesseract
```

### `auto` (default)

Tries Google Cloud Vision first (if `GOOGLE_VISION_API_KEY` is set), falls back to Tesseract.js.

### Google Cloud Vision (recommended for production)

Higher accuracy, handles low-quality images well. Requires an API key:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Cloud Vision API**
3. Create an API key under **APIs & Services → Credentials**
4. Set `GOOGLE_VISION_API_KEY=<your-key>`

```env
OCR_PROVIDER=auto
GOOGLE_VISION_API_KEY=AIzaSy...
```

### Tesseract.js (offline fallback)

Always available, no API key needed. Works offline. Uses ~10MB WASM — on memory-constrained serverless platforms (Vercel Hobby, Lambda 128MB) prefer Google Vision.

```env
OCR_PROVIDER=tesseract
```

---

## 6. Subscription Cron Setup

LifeFlow automatically creates expense records for due subscriptions. This requires a scheduler to periodically call:

```
POST /api/jobs/process-subscriptions
Authorization: Bearer <SCHEDULER_SECRET>
```

The endpoint is idempotent — safe to call as often as every 5 minutes.

### Vercel Cron (automatic on Vercel)

Add `vercel.json` to your repository root:

```json
{
  "crons": [
    {
      "path": "/api/jobs/process-subscriptions",
      "schedule": "0 * * * *"
    }
  ]
}
```

Set `CRON_SECRET` in Vercel environment variables. Vercel automatically passes it as the `Authorization` header.

### AWS EventBridge Scheduler

1. In AWS EventBridge, create a schedule: `rate(1 hour)`
2. Target: **Universal Targets → Invoke HTTP API**
3. URL: `https://your-app.com/api/jobs/process-subscriptions`
4. Method: `POST`
5. Headers: `Authorization: Bearer <SCHEDULER_SECRET>`

Alternatively use a Lambda function triggered by EventBridge that calls the endpoint via `fetch()`.

### Azure Logic Apps

1. Create a Logic App with a **Recurrence** trigger (every 1 hour)
2. Add an **HTTP** action:
   - Method: `POST`
   - URI: `https://your-app.com/api/jobs/process-subscriptions`
   - Headers: `Authorization: Bearer <SCHEDULER_SECRET>`

### External cron services

Any HTTP scheduler (cron-job.org, Uptime Robot, Better Uptime, EasyCron) can call this endpoint. Set the Authorization header with your `SCHEDULER_SECRET`.

---

## 7. Vercel Deployment

### Steps

1. Push your repository to GitHub / GitLab / Bitbucket
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Framework preset: **Next.js** (auto-detected)
4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string |
   | `SESSION_SECRET` | Random 32+ char string |
   | `SCHEDULER_SECRET` | Random 32+ char string (also set as `CRON_SECRET`) |
   | `CRON_SECRET` | Same value as `SCHEDULER_SECRET` |
   | `NEXT_PUBLIC_APP_URL` | `https://your-project.vercel.app` |
   | `NEXT_PUBLIC_CURRENCY` | `INR` |
   | `GOOGLE_VISION_API_KEY` | (optional) for better OCR |

5. Click **Deploy**

### Cron on Vercel

Add `vercel.json` at the project root:
```json
{
  "crons": [
    { "path": "/api/jobs/process-subscriptions", "schedule": "0 * * * *" }
  ]
}
```

### Custom domain

In **Project Settings → Domains**, add your custom domain and configure DNS.

### Notes

- Vercel ignores `output: 'standalone'` — it uses its own bundling
- File storage: set `STORAGE_PROVIDER=mongodb` (default) or use S3/Azure with env vars
- No server management required

---

## 8. AWS Deployment

### Recommended: AWS App Runner

App Runner runs containerized apps with zero server management.

#### Build and push the Docker image

```bash
# Build
docker build -t lifeflow .

# Tag for ECR
aws ecr create-repository --repository-name lifeflow --region ap-south-1
docker tag lifeflow:latest <account-id>.dkr.ecr.ap-south-1.amazonaws.com/lifeflow:latest

# Authenticate and push
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-south-1.amazonaws.com
docker push <account-id>.dkr.ecr.ap-south-1.amazonaws.com/lifeflow:latest
```

#### Create the App Runner service

1. Go to AWS App Runner → **Create service**
2. Source: **Container registry → Amazon ECR**
3. Select your `lifeflow` repository and tag
4. **Service settings:**
   - Port: `3000`
   - Health check path: `/api/health`
5. **Environment variables** — add all required vars (see section 3)
6. **IAM role** — create a role with S3 permissions if using `STORAGE_PROVIDER=s3`
7. Deploy

#### Subscription cron on AWS

Create an EventBridge Scheduler rule:
- Schedule: `rate(1 hour)`
- Target: HTTP endpoint → your App Runner URL + `/api/jobs/process-subscriptions`
- Headers: `Authorization: Bearer <SCHEDULER_SECRET>`

#### Alternative: AWS ECS / Fargate

Use the same Docker image with ECS Fargate:
1. Create an ECS cluster
2. Create a task definition using the ECR image
3. Set environment variables as ECS task environment or via AWS Secrets Manager
4. Create a service behind an ALB
5. Set the ALB target group health check path to `/api/health`

#### Custom domain

Use AWS Route 53 + ACM certificate + ALB (for ECS) or the built-in App Runner custom domain feature.

---

## 9. Azure Deployment

### Recommended: Azure Container Apps

#### Build and push to Azure Container Registry

```bash
# Create registry
az acr create --name lifeflowacr --resource-group lifeflow-rg \
  --sku Basic --admin-enabled true

# Build and push
az acr build --registry lifeflowacr --image lifeflow:latest .
```

#### Deploy to Container Apps

```bash
# Create environment
az containerapp env create \
  --name lifeflow-env \
  --resource-group lifeflow-rg \
  --location eastus

# Deploy
az containerapp create \
  --name lifeflow \
  --resource-group lifeflow-rg \
  --environment lifeflow-env \
  --image lifeflowacr.azurecr.io/lifeflow:latest \
  --target-port 3000 \
  --ingress external \
  --registry-server lifeflowacr.azurecr.io \
  --env-vars \
    MONGODB_URI=secretref:mongodb-uri \
    SESSION_SECRET=secretref:session-secret \
    SCHEDULER_SECRET=secretref:scheduler-secret \
    NEXT_PUBLIC_APP_URL=https://lifeflow.yourapp.azurecontainerapps.io \
    STORAGE_PROVIDER=azure \
    AZURE_STORAGE_ACCOUNT_NAME=mylifeflowestorage \
    NEXT_PUBLIC_CURRENCY=INR
```

#### Store secrets securely

```bash
az containerapp secret set --name lifeflow \
  --resource-group lifeflow-rg \
  --secrets \
    mongodb-uri="mongodb+srv://..." \
    session-secret="..." \
    scheduler-secret="..."
```

#### Subscription cron on Azure

Option A — Azure Container Apps Jobs (simplest):
```bash
az containerapp job create \
  --name lifeflow-subscription-job \
  --resource-group lifeflow-rg \
  --environment lifeflow-env \
  --trigger-type Schedule \
  --cron-expression "0 * * * *" \
  --image mcr.microsoft.com/azure-cli \
  --env-vars SCHEDULER_SECRET=secretref:scheduler-secret APP_URL=https://your-app-url \
  --command "curl -sf -X POST $APP_URL/api/jobs/process-subscriptions -H 'Authorization: Bearer $SCHEDULER_SECRET'"
```

Option B — Azure Logic Apps HTTP action on a recurrence trigger (see section 6).

#### Alternative: Azure App Service

1. Create an App Service Plan (B1 or higher)
2. Create a Web App → **Container** → select your ACR image
3. Under **Configuration → Application settings**, add all environment variables
4. Under **Health check**, set path to `/api/health`
5. Enable Managed Identity + assign `Storage Blob Data Contributor` for Azure Blob storage

#### Custom domain

In **App Service / Container Apps → Custom domains**, add your domain and bind a managed TLS certificate.

---

## 10. Docker

### Build

```bash
docker build -t lifeflow .
```

### Run

```bash
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/lifeflow" \
  -e SESSION_SECRET="your-32-char-secret" \
  -e SCHEDULER_SECRET="your-scheduler-secret" \
  -e NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  lifeflow
```

### With docker-compose

```bash
# Using MongoDB Atlas (recommended)
docker compose up

# With a local MongoDB instance
docker compose --profile local-mongo up
```

### Docker image details

- Base: `node:20-alpine`
- Multi-stage build: `deps → builder → runner`
- Final image: ~200–250MB (standalone output only)
- Non-root user: `nextjs` (uid 1001)
- Health check: `GET /api/health` every 30s

---

## 11. Health Checks

### `GET /api/health`

Full liveness check — verifies application + database connectivity.

```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-09-10T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600
}
```

Returns `200` when healthy, `503` when database is unreachable.

Use this for: AWS ALB / App Runner health checks, Azure App Service health probes, Docker `HEALTHCHECK`, Kubernetes liveness probes.

### `GET /api/ready`

Lightweight readiness probe — checks env vars only, no DB call.

```json
{
  "status": "ready",
  "timestamp": "2026-09-10T12:00:00.000Z",
  "checks": { "env": "ok" }
}
```

Returns `200` when ready, `503` when required env vars are missing.

Use this for: Kubernetes readiness probes, fast load balancer checks.

---

## 12. Email / Notifications

In-app notifications always work (stored in MongoDB). External email delivery is optional.

Set `EMAIL_PROVIDER` to one of: `none` (default), `resend`, `sendgrid`, `smtp`.

### Resend

```bash
npm install resend
```
```env
EMAIL_PROVIDER=resend
EMAIL_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com
```

### SendGrid

```bash
npm install @sendgrid/mail
```
```env
EMAIL_PROVIDER=sendgrid
EMAIL_API_KEY=SG....
EMAIL_FROM=noreply@yourdomain.com
```

### SMTP

```bash
npm install nodemailer @types/nodemailer
```
```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=your@gmail.com
```

---

## 13. Production Checklist

Before going live, verify each item:

### Security
- [ ] `SESSION_SECRET` is a cryptographically random string (min 32 chars): `openssl rand -base64 32`
- [ ] `SCHEDULER_SECRET` / `CRON_SECRET` set to a strong random string
- [ ] `MONGODB_URI` uses a dedicated database user with minimal permissions (not the Atlas admin)
- [ ] MongoDB Atlas Network Access restricted to your app's IPs (not `0.0.0.0/0` in production)
- [ ] `.env.local` and all `.env.*` files are in `.gitignore` and never committed
- [ ] No secrets in Docker image (verify with `docker history lifeflow`)
- [ ] Storage bucket / blob container has public access blocked

### Database
- [ ] `MONGODB_URI` points to production Atlas cluster
- [ ] MongoDB indexes created (run `npm run build` — the app creates indexes on first connect)
- [ ] Atlas backup enabled on production cluster

### Application
- [ ] `NEXT_PUBLIC_APP_URL` set to the production domain (not localhost)
- [ ] `NODE_ENV=production` (set automatically by Next.js in `npm run start`)
- [ ] `/api/health` returns `200` and `"database": "connected"`
- [ ] `/api/ready` returns `200` and `"status": "ready"`

### Storage
- [ ] `STORAGE_PROVIDER` set appropriately (`mongodb` for small deployments, `s3` or `azure` for scale)
- [ ] If using S3: bucket created, IAM permissions set, encryption enabled
- [ ] If using Azure Blob: container created, Managed Identity configured

### OCR
- [ ] `OCR_PROVIDER` set (`auto` recommended)
- [ ] `GOOGLE_VISION_API_KEY` set for production-quality OCR (optional but recommended)

### Subscriptions
- [ ] `SCHEDULER_SECRET` set and cron configured for `/api/jobs/process-subscriptions`
- [ ] Cron runs at least every hour
- [ ] First manual trigger verified: `curl -X POST https://your-app.com/api/jobs/process-subscriptions -H 'Authorization: Bearer <secret>'`

### CI/CD
- [ ] GitHub Actions CI passes (lint + build + docker build)
- [ ] Production deployment does not store secrets in repository
- [ ] Deployment secrets stored in platform secret manager (Vercel env, AWS Secrets Manager, Azure Key Vault)
