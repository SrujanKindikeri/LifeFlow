# LifeFlow — AWS EC2 Rebuild Runbook

Use this runbook to cleanly rebuild and redeploy LifeFlow on AWS EC2.
The same procedure applies to any Docker-capable VM (Azure, DigitalOcean, etc.).

> **MongoDB Atlas "test" database is never touched by these steps.**
> No collections are deleted. No users are affected. Only Docker containers
> and build artifacts are replaced.

---

## Pre-flight checklist

- [ ] You have SSH access to the EC2 instance
- [ ] A production `.env` file exists on the server (never committed to Git)
- [ ] The `.env` file contains valid values for all required variables (see below)
- [ ] You know which Git commit / branch to deploy

---

## Required environment variables (production `.env`)

The `.env` file on the EC2 host must contain at minimum:

```
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?appName=Cluster0
MONGODB_DB_NAME=test
SESSION_SECRET=<random 32+ char string — different from local>

NEXT_PUBLIC_APP_URL=https://<your-domain>    # or http://<EC2-IP>:3000 for direct access
NEXT_PUBLIC_CURRENCY=INR

EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=lifeflow4u.support@gmail.com
SMTP_PASSWORD=<App Password>
EMAIL_FROM=lifeflow4u.support@gmail.com
EMAIL_FROM_NAME=LifeFlow

TOTP_ENCRYPTION_KEY=<64-char hex string — different from local>

STORAGE_PROVIDER=mongodb
DEFAULT_TIMEZONE=Asia/Kolkata
LOG_LEVEL=info
```

> **Rules:**
> - `MONGODB_DB_NAME` MUST be `test` — that is where all LifeFlow data lives.
> - `SESSION_SECRET` MUST be different from the local dev secret.
> - `TOTP_ENCRYPTION_KEY` MUST be the same value used when 2FA was first enabled
>   for any user. Changing it permanently locks out 2FA users.
> - `NEXT_PUBLIC_APP_URL` MUST start with `https://` for the Secure cookie flag to
>   be set automatically. Set to `http://<IP>:3000` only for initial testing.
> - Never commit this file. Never print its contents in logs.

---

## Step 1 — SSH into the EC2 instance

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2-PUBLIC-IP>
```

---

## Step 2 — Navigate to the project directory

```bash
cd /home/ec2-user/lifeflow    # adjust if your path differs
```

---

## Step 3 — Stop and remove old LifeFlow containers

```bash
docker compose down --remove-orphans
```

This stops and removes containers. It does NOT remove volumes or the `.env` file.

---

## Step 4 — Remove the old Docker image (optional but recommended for a clean build)

```bash
docker rmi lifeflow-app 2>/dev/null || true
# Or target the specific image name shown by:
docker images | grep lifeflow
```

---

## Step 5 — Pull the latest code

```bash
git fetch origin
git checkout main          # or the specific branch/tag you want to deploy
git pull origin main
```

Verify you are on the correct commit:

```bash
git log --oneline -5
```

---

## Step 6 — Verify the `.env` file is present and correct

```bash
# Confirm the file exists
ls -la .env

# Confirm required variables are set (shows key names only, never values)
grep -E "^(MONGODB_URI|MONGODB_DB_NAME|SESSION_SECRET|NEXT_PUBLIC_APP_URL)=" .env
```

Expected output (values redacted):
```
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=test
SESSION_SECRET=...
NEXT_PUBLIC_APP_URL=https://...
```

If any are missing, edit `.env` before continuing.

---

## Step 7 — Build the Docker image cleanly

```bash
docker compose build --no-cache
```

`--no-cache` forces a full rebuild from scratch — important when dependencies
(`package.json`, `package-lock.json`) or source files have changed.

This step runs `npm ci`, `next build`, and produces a standalone image.
It takes 2–5 minutes depending on instance size. Expected last line:

```
✓ Compiled successfully
```

---

## Step 8 — Start the application

```bash
docker compose up -d
```

`-d` runs containers in the background.

---

## Step 9 — Verify containers are healthy

```bash
docker compose ps
```

Expected output — `Status` column should show `healthy` after ~30 seconds:

```
NAME         IMAGE       COMMAND         SERVICE   CREATED         STATUS
lifeflow-app lifeflow    "node server.js" app       10 seconds ago  Up 10 seconds (healthy)
```

If status is `starting`, wait 30 seconds and re-run. If it stays `unhealthy`, check logs immediately (Step 10).

---

## Step 10 — Check application logs

```bash
# Live tail (Ctrl-C to exit)
docker compose logs -f app

# Or last 100 lines only
docker compose logs --tail=100 app
```

Look for:
- `[startup] Startup tasks complete` — env validated, indexes ensured
- `[MongoDB] connected` — Atlas connection established
- No `[MongoDB] Connection failed` errors

---

## Step 11 — Test the health endpoint

```bash
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

Expected response (HTTP 200):
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "...",
  "version": "0.1.0",
  "uptime": 42
}
```

If `database` is `disconnected` or `error`:
1. Confirm `MONGODB_URI` in `.env` is correct
2. Confirm Atlas network access allows the EC2 instance IP
3. Check `docker compose logs app` for connection errors

---

## Step 12 — Test login and dashboard

Open a browser and navigate to:

```
http://<EC2-IP>:3000/login        # HTTP direct access
https://<your-domain>/login       # HTTPS via Nginx
```

1. Log in with an existing user from the `test` database
2. Verify redirect to `/app/dashboard`
3. Verify dashboard loads
4. Reload the page — dashboard must still load
5. Log out
6. Log in again — dashboard must still load

---

## Step 13 — Verify HTTPS (after app is confirmed working)

If using Nginx as a reverse proxy:

```bash
# Reload Nginx after any config changes
sudo nginx -t && sudo systemctl reload nginx

# Test HTTPS via curl
curl -sI https://<your-domain>/api/health
```

Expected: `HTTP/2 200` with the health JSON body.

> **Order matters:** confirm the application works over HTTP first, then
> enable/verify HTTPS. Debugging an HTTPS + app issue at the same time is
> harder than fixing them independently.

---

## Environment variable changes — full container recreation required

`docker compose restart` does NOT re-read environment variables.
When `.env` changes, always recreate containers:

```bash
docker compose down
docker compose up -d
```

Or in one step:

```bash
docker compose up -d --force-recreate
```

---

## Rollback

If the new deployment is broken, roll back to the previous commit:

```bash
docker compose down
git checkout <previous-commit-sha>
docker compose build --no-cache
docker compose up -d
```

---

## Azure deployment

Use the exact same procedure above — the Dockerfile, docker-compose.yml, and
application code are identical. Only the `.env` file differs:

```
NEXT_PUBLIC_APP_URL=https://<azure-domain>
NEXT_PUBLIC_APP_URL=http://<Azure-IP>:3000   # for HTTP-only testing
```

All other variables, including `MONGODB_URI=...` and `MONGODB_DB_NAME=test`,
are identical to AWS — both environments connect to the same Atlas cluster.

Once Local and AWS are confirmed stable, deploy to Azure from the exact same
Git commit that is running on AWS.

---

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Login loops back to `/login` | Stale browser cookie | Clear `lifeflow_session` cookie in DevTools → Application → Cookies, then log in fresh |
| `user_found: false` in logs (dev) | Session userId not in this DB | Stale session — fixed automatically; user is redirected to `/login` |
| Health returns `database: disconnected` | Wrong `MONGODB_URI` or Atlas IP not whitelisted | Fix `.env`, recreate containers, check Atlas Network Access |
| Health returns `database: error` | Atlas connection timeout | Check Atlas cluster status, EC2 security group allows outbound 27017 |
| Container stays `unhealthy` | App crashed on startup | Run `docker compose logs app`, look for missing env var or connection error |
| `SESSION_SECRET` error at startup | Variable missing or < 32 chars | Add/fix `SESSION_SECRET` in `.env`, recreate containers |
| 2FA locked out after redeploy | `TOTP_ENCRYPTION_KEY` changed | Restore the original key value — it must not change after users enable 2FA |
