# Deploying LifeFlow to Vercel

## Prerequisites

- A GitHub / GitLab / Bitbucket repository containing the LifeFlow source
- A [Vercel](https://vercel.com) account
- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (M0 Free Tier works)

---

## 1. MongoDB Atlas setup

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Under **Database Access** → add a database user with a strong password.
3. Under **Network Access** → add `0.0.0.0/0` (allow all IPs — Vercel uses dynamic IPs).
4. Click **Connect** → **Connect your application** → copy the connection string.
5. Replace `<password>` with your database user's password.

---

## 2. Import project into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import your Git repository.
2. Framework preset: **Next.js** (auto-detected).
3. Leave the build command as the default (`next build`).

---

## 3. Environment variables

Set these in **Project Settings → Environment Variables** (Production + Preview + Development):

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | Full Atlas connection string (never commit this) |
| `SESSION_SECRET` | ✅ | Random 32+ char string: `openssl rand -base64 32` |
| `CRON_SECRET` | ✅ | Secret for Vercel Cron job: `openssl rand -base64 32` |
| `SCHEDULER_SECRET` | ✅ | Set to the same value as `CRON_SECRET` |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://your-project.vercel.app` (or custom domain) |
| `NEXT_PUBLIC_CURRENCY` | recommended | `INR` (or your currency code) |
| `DEFAULT_TIMEZONE` | recommended | `Asia/Kolkata` (or your timezone) |
| `STORAGE_PROVIDER` | optional | `mongodb` (default) or `s3` / `azure` |
| `GOOGLE_VISION_API_KEY` | optional | Improves OCR accuracy |
| `OCR_PROVIDER` | optional | `auto` (default) |
| `LOG_LEVEL` | optional | `info` (default) |

> **Never** use `NEXT_PUBLIC_` prefix for secrets. Only `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_CURRENCY` belong in the public namespace.

---

## 4. Cron job (subscription scheduler)

`vercel.json` at the repository root already configures the cron:

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

Vercel automatically passes the `CRON_SECRET` as the `Authorization: Bearer` header.  
The endpoint runs at the top of every hour.

> Cron jobs require the **Vercel Pro plan** or higher. On the Hobby plan, trigger manually or use an external scheduler (cron-job.org).

---

## 5. Deploy

Click **Deploy** in the Vercel dashboard, or push to your main branch.

---

## 6. Post-deployment verification

```bash
# Health check
curl https://your-project.vercel.app/api/health

# Readiness check
curl https://your-project.vercel.app/api/ready

# Manual scheduler trigger (first run)
curl -X POST https://your-project.vercel.app/api/jobs/process-subscriptions \
  -H "Authorization: Bearer <SCHEDULER_SECRET>"
```

Expected health response:
```json
{ "status": "ok", "database": "connected", "timestamp": "...", "uptime": 12 }
```

---

## 7. Custom domain

In **Project Settings → Domains**, add your domain and configure the DNS records Vercel shows you.

---

## 8. Notes on Vercel serverless

- Vercel ignores `output: 'standalone'` in `next.config.ts` — it uses its own bundling. This is expected.
- Each API route runs as a separate serverless function. MongoDB connections are cached per function instance via the global cache in `lib/db.ts`.
- Vercel function timeout default is 10 seconds (Hobby) / 60 seconds (Pro). OCR with Tesseract can be slow — set `OCR_PROVIDER=google_vision` or ensure the function timeout is at least 30 seconds.
- File storage: `STORAGE_PROVIDER=mongodb` (default) stores screenshots in Atlas. Switch to `s3` or `azure` for large deployments.
- There is no persistent local filesystem on Vercel — `STORAGE_PROVIDER=local` will throw an error at startup.
