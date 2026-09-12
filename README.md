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
| `npm test` | Run test suite |

---

## Environment variables

All configuration is via environment variables — no secrets are hard-coded.

Copy `.env.example` to `.env.local` and fill in values. The full reference with descriptions is in `.env.example`.

### Required (all platforms)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `SESSION_SECRET` | iron-session encryption key (min 32 chars) — `openssl rand -base64 32` |

### Recommended

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Full URL of the app (no trailing slash) |
| `NEXT_PUBLIC_CURRENCY` | `INR` | Default currency code |
| `SCHEDULER_SECRET` | — | Protects `/api/jobs/process-subscriptions` — `openssl rand -base64 32` |
| `EMAIL_PROVIDER` | `none` | `smtp` for production email |
| `SMTP_HOST` | — | SMTP relay hostname |
| `SMTP_PORT` | `587` | SMTP port (587 = STARTTLS, 465 = implicit TLS) |
| `SMTP_USER` | — | SMTP username / login |
| `SMTP_PASSWORD` | — | SMTP password / app password |
| `EMAIL_FROM` | — | Sender address |
| `TOTP_ENCRYPTION_KEY` | — | AES-256-GCM key for 2FA — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | IANA timezone for date calculations |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Never put these in `NEXT_PUBLIC_*` variables

`MONGODB_URI`, `SESSION_SECRET`, `SCHEDULER_SECRET`, `CRON_SECRET`, `SMTP_PASSWORD`, `TOTP_ENCRYPTION_KEY`, `STORAGE_SECRET_ACCESS_KEY`, `AZURE_STORAGE_ACCOUNT_KEY`, `GOOGLE_VISION_API_KEY`, `OCR_API_KEY`, `EMAIL_API_KEY`

---

## Architecture

```
Browser
  ↓  HTTP / HTTPS
Nginx / Apache (TLS termination, reverse proxy)
  ↓
Docker container — Next.js 16 App Router (Node.js 22)
  ↓
MongoDB Atlas (database + optional file storage)
  ↓  (optional)
SMTP relay — any provider (Gmail, Brevo, Mailgun, etc.)
```

The same Docker image runs identically on **AWS EC2**, **Azure VM**, or any Docker host. There are no cloud-specific runtime dependencies.

---

## Docker

```bash
# Build
docker build -t lifeflow:latest .

# Run (supply all secrets at runtime — never bake into the image)
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/lifeflow" \
  -e SESSION_SECRET="your-32-char-secret" \
  -e SCHEDULER_SECRET="your-scheduler-secret" \
  -e NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  -e EMAIL_PROVIDER="smtp" \
  -e SMTP_HOST="smtp.example.com" \
  -e SMTP_PORT="587" \
  -e SMTP_USER="noreply@example.com" \
  -e SMTP_PASSWORD="your-smtp-password" \
  -e EMAIL_FROM="noreply@example.com" \
  -e TOTP_ENCRYPTION_KEY="your-64-char-hex-key" \
  lifeflow:latest

# With docker compose (reads from .env.local automatically)
docker compose up

# With a local MongoDB instance (development only)
docker compose --profile local-mongo up
```

The Docker image uses a **multi-stage build** (`deps → builder → runner`) with **Node.js 22-alpine** and runs as a **non-root user** (uid 1001). The final image is ~200–250 MB.

---

## Health checks

| Endpoint | Purpose | Healthy response |
|---|---|---|
| `GET /api/health` | Liveness + DB ping | HTTP 200, `"status":"ok"` |
| `GET /api/ready` | Readiness (env only, no DB) | HTTP 200, `"status":"ready"` |

Example `/api/health` response:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-09-12T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600
}
```

Use `/api/health` for AWS ALB target groups, Azure load balancer probes, Docker `HEALTHCHECK`, and Kubernetes liveness probes.

---

## Subscription scheduler

LifeFlow automatically creates expense records for due subscriptions. A scheduler must periodically call:

```bash
POST /api/jobs/process-subscriptions
Authorization: Bearer <SCHEDULER_SECRET>
```

The endpoint is **idempotent** — safe to call as often as every 5 minutes.

| Platform | Method |
|---|---|
| **EC2 / Azure VM** | System cron (see deployment guides below) |
| **External service** | cron-job.org, Uptime Robot, or any HTTP scheduler |
| **AWS EventBridge** | HTTP target → this endpoint |
| **Azure Logic Apps** | HTTP action → this endpoint |

---

## Deployment — AWS EC2

Deploy the exact same Docker image on any EC2 instance running Amazon Linux 2023, Ubuntu, or another Linux distribution.

### Prerequisites

- EC2 instance (t3.small or larger recommended for production)
- Security group: inbound TCP 3000 (or 80/443 with reverse proxy)
- MongoDB Atlas cluster with network access from the EC2 IP
- An SMTP relay (Gmail App Password, Brevo free tier, Mailgun, etc.)

### Step 1 — Install Docker

```bash
# Amazon Linux 2023
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
# Log out and back in for the group change to take effect

# Ubuntu 22.04 / 24.04
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
```

### Step 2 — Clone the repository

```bash
git clone https://github.com/your-org/lifeflow.git
cd lifeflow
```

### Step 3 — Create `.env`

```bash
cp .env.example .env
nano .env
```

Fill in **all** required values:

```env
# Required
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/lifeflow?retryWrites=true&w=majority
SESSION_SECRET=<openssl rand -base64 32>
SCHEDULER_SECRET=<openssl rand -base64 32>
TOTP_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# App URL — use your EC2 public IP for initial testing
# Replace with your domain once HTTPS is configured
NEXT_PUBLIC_APP_URL=http://<EC2-PUBLIC-IP>:3000
NEXT_PUBLIC_CURRENCY=INR

# Email (set EMAIL_PROVIDER=none to skip email during initial testing)
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=LifeFlow
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=<16-char-app-password>

# Defaults
DEFAULT_TIMEZONE=Asia/Kolkata
LOG_LEVEL=info
```

> **Security**: Port 25 is blocked on AWS EC2. Use port 587 (STARTTLS) or 465 (TLS).

### Step 4 — Build and run

```bash
# Build the image
docker build -t lifeflow:latest .

# Run the container (reads .env at runtime)
docker run -d \
  --name lifeflow \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  lifeflow:latest
```

### Step 5 — Open port 3000 (for initial HTTP testing)

In the AWS Console → EC2 → Security Groups → Add inbound rule:
- Type: Custom TCP
- Port: 3000
- Source: My IP (or 0.0.0.0/0 for public access — use HTTPS for production)

### Step 6 — Verify the deployment

```bash
# Health check
curl http://<EC2-PUBLIC-IP>:3000/api/health

# Expected response
{"status":"ok","database":"connected","timestamp":"...","version":"0.1.0","uptime":60}

# View logs
docker logs -f lifeflow
```

### Step 7 — Configure the cron scheduler

```bash
# Edit the ec2-user (or ubuntu) crontab
crontab -e

# Add this line — calls the scheduler every hour
0 * * * * curl -fsS -X POST \
  -H "Authorization: Bearer <SCHEDULER_SECRET>" \
  http://localhost:3000/api/jobs/process-subscriptions \
  >> /var/log/lifeflow-cron.log 2>&1
```

### Step 8 — Configure HTTPS reverse proxy (production)

Install Nginx and Certbot:

```bash
# Amazon Linux 2023
sudo dnf install -y nginx python3-certbot-nginx
sudo systemctl enable --now nginx

# Ubuntu
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

Create `/etc/nginx/conf.d/lifeflow.conf`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx

# Issue TLS certificate
sudo certbot --nginx -d yourdomain.com
```

Then update your `.env`:

```env
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

And redeploy:

```bash
docker stop lifeflow && docker rm lifeflow
docker run -d --name lifeflow --restart unless-stopped -p 3000:3000 --env-file .env lifeflow:latest
```

### Updating the deployment

```bash
git pull
docker build -t lifeflow:latest .
docker stop lifeflow && docker rm lifeflow
docker run -d --name lifeflow --restart unless-stopped -p 3000:3000 --env-file .env lifeflow:latest
```

---

## Deployment — Azure VM

The exact same Docker image runs on an Azure Virtual Machine. Only the infrastructure setup differs.

### Prerequisites

- Azure VM (Standard_B2s or larger recommended — 2 vCPU, 4 GB RAM)
- Network Security Group: inbound TCP 3000 (or 80/443 with reverse proxy)
- MongoDB Atlas cluster with network access from the Azure VM IP
- An SMTP relay

### Step 1 — Install Docker

```bash
# Ubuntu 22.04 / 24.04 (default Azure VM image)
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker azureuser
# Log out and back in for the group change to take effect
```

### Step 2 — Clone the repository

```bash
git clone https://github.com/your-org/lifeflow.git
cd lifeflow
```

### Step 3 — Create `.env`

```bash
cp .env.example .env
nano .env
```

Fill in all required values (same as the EC2 guide above, but with your Azure VM's public IP):

```env
# Required
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/lifeflow?retryWrites=true&w=majority
SESSION_SECRET=<openssl rand -base64 32>
SCHEDULER_SECRET=<openssl rand -base64 32>
TOTP_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# App URL — use your Azure VM public IP for initial testing
NEXT_PUBLIC_APP_URL=http://<AZURE-VM-PUBLIC-IP>:3000
NEXT_PUBLIC_CURRENCY=INR

# Email
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=LifeFlow
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASSWORD=<brevo-smtp-key>

# Defaults
DEFAULT_TIMEZONE=Asia/Kolkata
LOG_LEVEL=info
```

> **Note**: Port 25 is also blocked on Azure VMs. Use port 587 or 465. Brevo (formerly Sendinblue) has a generous free tier and works well from Azure.

### Step 4 — Build and run

```bash
docker build -t lifeflow:latest .

docker run -d \
  --name lifeflow \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  lifeflow:latest
```

### Step 5 — Open port 3000 in NSG (initial testing)

In the Azure Portal → Virtual Machines → Networking → Add inbound port rule:
- Source: Any (or your IP for security)
- Destination port: 3000
- Protocol: TCP
- Action: Allow

### Step 6 — Verify the deployment

```bash
curl http://<AZURE-VM-PUBLIC-IP>:3000/api/health
# {"status":"ok","database":"connected",...}

docker logs -f lifeflow
```

### Step 7 — Configure the cron scheduler

```bash
crontab -e

# Add (runs every hour)
0 * * * * curl -fsS -X POST \
  -H "Authorization: Bearer <SCHEDULER_SECRET>" \
  http://localhost:3000/api/jobs/process-subscriptions \
  >> /var/log/lifeflow-cron.log 2>&1
```

### Step 8 — Configure HTTPS reverse proxy (production)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

Create `/etc/nginx/sites-available/lifeflow`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lifeflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

Then update `.env` with `NEXT_PUBLIC_APP_URL=https://yourdomain.com` and redeploy:

```bash
docker stop lifeflow && docker rm lifeflow
docker run -d --name lifeflow --restart unless-stopped -p 3000:3000 --env-file .env lifeflow:latest
```

### Updating the deployment

```bash
git pull
docker build -t lifeflow:latest .
docker stop lifeflow && docker rm lifeflow
docker run -d --name lifeflow --restart unless-stopped -p 3000:3000 --env-file .env lifeflow:latest
```

---

## Generating secrets

```bash
# SESSION_SECRET (32+ chars)
openssl rand -base64 32

# SCHEDULER_SECRET
openssl rand -base64 32

# TOTP_ENCRYPTION_KEY (64 hex chars = 32 bytes = 256 bits)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Storage

Transaction screenshots can be stored in three ways. Set `STORAGE_PROVIDER` to choose.

| Provider | `STORAGE_PROVIDER` | Notes |
|---|---|---|
| MongoDB (default) | `mongodb` | Zero extra setup — stored in Atlas |
| AWS S3 | `s3` | Requires `STORAGE_BUCKET`, `STORAGE_REGION`, optionally access keys |
| Azure Blob | `azure` | Requires `AZURE_STORAGE_ACCOUNT_NAME`, optionally account key |
| Local filesystem | `local` | **Development only** — ephemeral, not for production |

> **Container-local storage**: `STORAGE_PROVIDER=local` writes to the container filesystem. Files are lost on every container restart. It is blocked at startup when `NODE_ENV=production`.

---

## OCR

| Setting | Description |
|---|---|
| `OCR_PROVIDER=auto` | Try Google Vision (if key set), fall back to Tesseract (default) |
| `OCR_PROVIDER=google_vision` | Google Cloud Vision API only |
| `OCR_PROVIDER=tesseract` | Tesseract.js only (offline, no API key needed) |

---

## Rate limiting

Auth endpoints use **in-memory** sliding-window rate limiting (no Redis required):

- Login: 10 attempts / 5 min per IP, 5 / 5 min per email
- TOTP verify: 5 attempts / 5 min per pending session
- Resend verification: 1 / 60 s cooldown + 5 / hr per email + 10 / hr per IP
- Recovery codes: 5 attempts / 15 min per user

**Single-instance limitation**: counters are process-local and reset on restart. For multi-replica deployments, replace the in-memory store with Redis.

---

## Backup considerations

MongoDB Atlas provides automated backups on paid tiers (M10+). For the free M0 tier:

```bash
# Manual snapshot using mongodump (run from any machine with Atlas access)
mongodump \
  --uri="mongodb+srv://user:pass@cluster.mongodb.net/lifeflow" \
  --out="backup-$(date +%Y%m%d)"
```

---

## Secret rotation

1. **SESSION_SECRET**: Generate a new value. All existing sessions are immediately invalidated — users must log in again. Update `.env` and redeploy.
2. **TOTP_ENCRYPTION_KEY**: Requires a migration script to re-encrypt all stored TOTP secrets. Do not change this without a migration.
3. **SCHEDULER_SECRET / CRON_SECRET**: Update `.env` and update the cron job command on the VM.
4. **SMTP_PASSWORD**: Update `.env` and redeploy. No data migration needed.

---

## Security notes

- Sessions are encrypted with `iron-session` (AES-GCM), stored in HTTP-only cookies.
- Cookies use the `Secure` flag only when `NEXT_PUBLIC_APP_URL` starts with `https://` — intentionally allowing HTTP for initial VM testing.
- All API routes derive `userId` from the server-side session — never from request bodies.
- MongoDB queries always include `userId` for ownership enforcement.
- Email verification tokens are SHA-256 hashed before storage — raw tokens exist only in emails.
- TOTP secrets are AES-256-GCM encrypted at rest using `TOTP_ENCRYPTION_KEY`.
- The scheduler endpoint requires `Authorization: Bearer <secret>`.
- OCR raw text (`rawText`) is excluded from default Mongoose queries (`select: false`).
- Security headers (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS) are set in `next.config.ts`. HSTS is only sent when `NEXT_PUBLIC_APP_URL` starts with `https://`.
- `STORAGE_PROVIDER=local` is blocked at startup in `NODE_ENV=production`.
