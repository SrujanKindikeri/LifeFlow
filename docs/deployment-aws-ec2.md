# Deploying LifeFlow to AWS EC2

## Architecture

```
Internet (HTTPS 443)
        ↓
  AWS EC2 (Ubuntu)
        ↓
    NGINX (TLS termination, reverse proxy)
        ↓
  LifeFlow Docker container (port 3000)
        ↓
  MongoDB Atlas (cloud-hosted)
```

Optional: AWS S3 for transaction screenshots.

---

## Prerequisites

- An AWS account
- An EC2 instance running Ubuntu 22.04 (t3.small or larger recommended)
- An Elastic IP or a DNS A record pointing to your instance's public IP
- A MongoDB Atlas cluster

---

## 1. Launch EC2 instance

### Recommended instance type

| Workload | Instance |
|---|---|
| Development / small | t3.micro (1 vCPU, 1 GB RAM) |
| Production / small | t3.small (2 vCPU, 2 GB RAM) |
| Production / medium | t3.medium (2 vCPU, 4 GB RAM) |

### Security Group rules

| Type | Port | Source | Purpose |
|---|---|---|---|
| SSH | 22 | Your IP only | Administration |
| HTTP | 80 | 0.0.0.0/0 | Let's Encrypt + redirect |
| HTTPS | 443 | 0.0.0.0/0 | Application traffic |

---

## 2. Install Docker on the instance

```bash
# SSH in
ssh -i your-key.pem ubuntu@<YOUR_EC2_IP>

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt-get install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

---

## 3. Install NGINX and Certbot

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

---

## 4. Deploy LifeFlow

### 4a. Clone the repository

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> lifeflow
sudo chown -R $USER:$USER lifeflow
cd lifeflow
```

### 4b. Create the environment file

```bash
cp .env.example .env.local
nano .env.local
```

Fill in at minimum:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/lifeflow?retryWrites=true&w=majority
SESSION_SECRET=<generate: openssl rand -base64 32>
SCHEDULER_SECRET=<generate: openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=https://YOUR_DOMAIN
NEXT_PUBLIC_CURRENCY=INR
DEFAULT_TIMEZONE=Asia/Kolkata
STORAGE_PROVIDER=mongodb
OCR_PROVIDER=auto
NODE_ENV=production
```

### 4c. Build and start

```bash
docker compose up -d --build

# Verify
docker compose ps
curl http://localhost:3000/api/health
```

---

## 5. Configure NGINX

```bash
sudo cp /opt/lifeflow/deploy/nginx/lifeflow.conf.example \
        /etc/nginx/sites-available/lifeflow

# Replace YOUR_DOMAIN
sudo sed -i 's/YOUR_DOMAIN/your-actual-domain.com/g' \
     /etc/nginx/sites-available/lifeflow

sudo ln -s /etc/nginx/sites-available/lifeflow /etc/nginx/sites-enabled/lifeflow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Obtain TLS certificate

```bash
sudo certbot --nginx -d YOUR_DOMAIN
# Follow the prompts. Certbot edits the NGINX config automatically.

# Verify auto-renewal
sudo certbot renew --dry-run
```

---

## 7. Subscription cron job

### Option A — systemd timer (recommended)

```bash
# Create service unit
sudo tee /etc/systemd/system/lifeflow-scheduler.service > /dev/null <<'EOF'
[Unit]
Description=LifeFlow subscription scheduler
After=network.target

[Service]
Type=oneshot
EnvironmentFile=/opt/lifeflow/.env.local
ExecStart=/usr/bin/curl -sf -X POST \
  https://YOUR_DOMAIN/api/jobs/process-subscriptions \
  -H "Authorization: Bearer ${SCHEDULER_SECRET}"
EOF

# Create timer unit
sudo tee /etc/systemd/system/lifeflow-scheduler.timer > /dev/null <<'EOF'
[Unit]
Description=Run LifeFlow subscription scheduler every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now lifeflow-scheduler.timer
```

### Option B — AWS EventBridge Scheduler

1. In the AWS console → **EventBridge Scheduler** → Create schedule
2. Schedule: `rate(1 hour)`
3. Target: **Universal targets → API destination**
4. URL: `https://YOUR_DOMAIN/api/jobs/process-subscriptions`
5. HTTP method: `POST`
6. Headers: `Authorization: Bearer <SCHEDULER_SECRET>`

### Option C — cron job

```bash
crontab -e
# Add:
0 * * * * curl -sf -X POST https://YOUR_DOMAIN/api/jobs/process-subscriptions -H "Authorization: Bearer <SCHEDULER_SECRET>" >/dev/null 2>&1
```

---

## 8. Optional: AWS S3 for file storage

### Create an S3 bucket

```bash
aws s3api create-bucket \
  --bucket lifeflow-transaction-proofs \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block all public access
aws s3api put-public-access-block \
  --bucket lifeflow-transaction-proofs \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Attach an IAM role (recommended — no access keys in env)

1. Create an IAM role with the trust policy for EC2
2. Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::lifeflow-transaction-proofs",
        "arn:aws:s3:::lifeflow-transaction-proofs/*"
      ]
    }
  ]
}
```

3. Attach the role to your EC2 instance
4. In `.env.local`:

```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=lifeflow-transaction-proofs
STORAGE_REGION=ap-south-1
# Leave STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY empty — uses IAM role
```

### With explicit credentials (non-EC2 / dev)

```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=lifeflow-transaction-proofs
STORAGE_REGION=ap-south-1
STORAGE_ACCESS_KEY_ID=AKIA...
STORAGE_SECRET_ACCESS_KEY=...
```

> Install the AWS SDK packages before using S3:
> `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

---

## 9. Updates and rollback

```bash
cd /opt/lifeflow

# Update
git pull origin main
docker compose up -d --build

# Rollback to a specific commit
git checkout <commit-sha>
docker compose up -d --build
```

---

## 10. Monitoring

```bash
# Application logs
docker compose logs -f app

# Health check
curl https://YOUR_DOMAIN/api/health

# NGINX logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Container resource usage
docker stats lifeflow-app-1
```

---

## 11. Security hardening

- Assign an Elastic IP so your IP doesn't change on stop/start
- Enable EC2 Instance Connect or AWS Systems Manager Session Manager instead of open SSH
- Restrict SSH Security Group rule to your static IP
- Enable MongoDB Atlas IP allowlist — add only the EC2 Elastic IP (not 0.0.0.0/0)
- Enable automatic security updates: `sudo apt-get install -y unattended-upgrades`
- Store secrets in AWS Secrets Manager and inject via a startup script (advanced)
