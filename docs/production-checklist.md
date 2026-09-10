# LifeFlow — Production Checklist

Work through this list before and after every production deployment.

---

## Security

- [ ] `SESSION_SECRET` is a cryptographically random string ≥ 32 characters
      `openssl rand -base64 32`
- [ ] `SCHEDULER_SECRET` / `CRON_SECRET` is a strong random string
- [ ] `MONGODB_URI` uses a dedicated Atlas user with minimal permissions (not the admin user)
- [ ] MongoDB Atlas **Network Access** is locked to your app's IP(s), not `0.0.0.0/0`
- [ ] `.env.local` and all `.env.*` files are in `.gitignore` and not in the repository
- [ ] `.env.example` contains **no real credentials** — only placeholder values
- [ ] No secrets in Docker image: verify with `docker history lifeflow --no-trunc | grep -i secret`
- [ ] S3 bucket / Azure Blob container has **public access blocked**
- [ ] If using S3: server-side encryption enabled (AES256 or KMS)
- [ ] `NEXT_PUBLIC_*` variables contain **no secrets** — only app URL and currency

---

## Application

- [ ] `NEXT_PUBLIC_APP_URL` is set to the production domain (not localhost)
- [ ] `NODE_ENV=production` (set automatically by Next.js `next start` / Docker runner stage)
- [ ] `LOG_LEVEL=info` (or `warn` in production for lower noise)
- [ ] `/api/health` returns `{"status":"ok","database":"connected",...}` with HTTP 200
- [ ] `/api/ready` returns `{"status":"ready",...}` with HTTP 200
- [ ] Login works on the production domain
- [ ] Logout invalidates the session (reload redirects to /login)
- [ ] Dashboard loads after login and session survives page refresh

---

## Database

- [ ] `MONGODB_URI` points to the production Atlas cluster
- [ ] Database name in the URI (or `MONGODB_DB_NAME`) is correct
- [ ] MongoDB indexes are created (app creates them on first connect via `ensureIndexes()`)
- [ ] Atlas **M2+ cluster** (or higher) for production — M0 Free Tier has connection limits
- [ ] Atlas **Backup** enabled on the production cluster

---

## Storage

- [ ] `STORAGE_PROVIDER` is set to the appropriate value for your platform:
  - Vercel: `mongodb` (default) or `s3`
  - AWS EC2: `mongodb` or `s3`
  - Azure VM: `mongodb` or `azure`
  - Never use `local` in production
- [ ] Transaction proof upload works end-to-end (upload → view → delete)

---

## OCR

- [ ] `OCR_PROVIDER=auto` (recommended) or explicit provider
- [ ] If using Google Vision: `GOOGLE_VISION_API_KEY` is set and the Cloud Vision API is enabled
- [ ] Test OCR: upload a transaction screenshot and verify parsing works

---

## Subscriptions / Cron

- [ ] `SCHEDULER_SECRET` is set in production environment
- [ ] Cron is configured to call `/api/jobs/process-subscriptions` at least once per hour
  - Vercel: `vercel.json` crons + `CRON_SECRET` env var
  - EC2 / Azure VM: systemd timer or crontab
  - AWS: EventBridge Scheduler
- [ ] Manual trigger verified:
      `curl -X POST https://your-domain.com/api/jobs/process-subscriptions -H "Authorization: Bearer <SCHEDULER_SECRET>"`
- [ ] Response includes `"ok": true`

---

## Docker (EC2 / Azure VM)

- [ ] `docker build -t lifeflow .` succeeds without errors
- [ ] `docker run` starts the container and `/api/health` returns 200
- [ ] Container runs as non-root user (uid 1001 `nextjs`)
- [ ] No `.env.local` or `.env.*` files inside the Docker image
      Verify: `docker run --rm lifeflow ls -la | grep ".env"`
- [ ] Health check passes: `docker inspect lifeflow | grep -A5 Health`

---

## NGINX / TLS

- [ ] HTTP → HTTPS redirect works
- [ ] TLS certificate is valid and not expiring soon
- [ ] `Strict-Transport-Security` header present in responses
- [ ] `X-Frame-Options: SAMEORIGIN` header present
- [ ] Upload size limit (`client_max_body_size`) set to at least 12m in NGINX

---

## CI/CD

- [ ] GitHub Actions CI passes (lint + build + docker build) on `main` branch
- [ ] No secrets stored in repository, CI environment variables, or workflow files
- [ ] Production deploy does not use `--no-verify` or `--force`

---

## Post-deployment smoke test

Run these after every deployment:

```bash
BASE=https://your-domain.com

# 1. Readiness
curl -f "$BASE/api/ready"

# 2. Health (includes DB check)
curl -f "$BASE/api/health"

# 3. Login page loads
curl -f "$BASE/login" -o /dev/null -w "%{http_code}"
# Expected: 200

# 4. Unauthenticated dashboard redirect
curl -f "$BASE/app/dashboard" -o /dev/null -w "%{http_code}"
# Expected: 307 or 302 (redirect to /login)

# 5. Scheduler endpoint (replace SECRET)
curl -X POST "$BASE/api/jobs/process-subscriptions" \
  -H "Authorization: Bearer <SCHEDULER_SECRET>"
# Expected: {"ok":true,...}
```

---

## Rollback procedure

```bash
# Docker / VM deployments
cd /opt/lifeflow
git log --oneline -10            # find the previous good commit
git checkout <previous-sha>
docker compose up -d --build

# Verify health after rollback
curl https://your-domain.com/api/health
```

For Vercel: use **Deployments** → click a previous deployment → **Promote to Production**.

---

## Backup considerations

- MongoDB Atlas M2+ includes daily automated backups. Enable and verify.
- For M0 (free): export manually with `mongodump` before major schema changes.
- Transaction proof images stored in MongoDB are included in Atlas backups.
- If using S3: enable S3 Versioning and MFA Delete on the bucket.
- If using Azure Blob: enable soft delete and versioning on the container.
