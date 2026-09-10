# Deploying LifeFlow to an Azure VM

## Architecture

```
Internet (HTTPS 443)
        ↓
  Azure VM (Ubuntu)
        ↓
    NGINX (TLS termination, reverse proxy)
        ↓
  LifeFlow Docker container (port 3000)
        ↓
  MongoDB Atlas (cloud-hosted)
```

Optional: Azure Blob Storage for transaction screenshots.

---

## Prerequisites

- An Azure account with a running Ubuntu 22.04 VM (Standard B2s or higher recommended)
- DNS A record pointing your domain at the VM's public IP
- [Docker](https://docs.docker.com/engine/install/ubuntu/) and [Docker Compose](https://docs.docker.com/compose/install/) installed on the VM
- A MongoDB Atlas cluster

---

## 1. Provision the VM

### Minimum recommended spec

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPUs |
| RAM | 1 GB | 4 GB |
| Storage | 30 GB SSD | 50 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Open ports

In the Azure portal → VM → **Networking**, open inbound rules for:
- Port **80** (HTTP — for Let's Encrypt challenge and redirect)
- Port **443** (HTTPS)
- Port **22** (SSH — restrict to your IP in production)

---

## 2. Install Docker on the VM

```bash
# Connect to VM
ssh azureuser@<YOUR_VM_IP>

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

### 4c. Build and start the container

```bash
docker compose up -d --build
```

Verify the container is running:

```bash
docker compose ps
docker compose logs -f app
```

Check the health endpoint (before NGINX):

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","database":"connected",...}`

---

## 5. Configure NGINX

```bash
# Copy the example config
sudo cp /opt/lifeflow/deploy/nginx/lifeflow.conf.example \
        /etc/nginx/sites-available/lifeflow

# Edit it — replace YOUR_DOMAIN with your actual domain
sudo nano /etc/nginx/sites-available/lifeflow

# Enable the site
sudo ln -s /etc/nginx/sites-available/lifeflow /etc/nginx/sites-enabled/lifeflow

# Remove the default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test the config
sudo nginx -t

# Reload NGINX (HTTP-only at this point)
sudo systemctl reload nginx
```

---

## 6. Obtain TLS certificate (Let's Encrypt)

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot automatically:
- Obtains a certificate from Let's Encrypt
- Modifies your NGINX config to add the `ssl_certificate` lines
- Sets up HTTPS redirect

Verify auto-renewal:

```bash
sudo certbot renew --dry-run
```

Certbot installs a systemd timer for automatic renewal. No manual action needed.

---

## 7. Subscription cron job

The scheduler endpoint must be called at least once per hour. Two options:

### Option A — systemd timer (recommended for VMs)

Create the timer files:

```bash
sudo tee /etc/systemd/system/lifeflow-scheduler.service > /dev/null <<EOF
[Unit]
Description=LifeFlow subscription scheduler
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -sf -X POST \
  https://YOUR_DOMAIN/api/jobs/process-subscriptions \
  -H "Authorization: Bearer $(grep SCHEDULER_SECRET /opt/lifeflow/.env.local | cut -d= -f2)"
EOF

sudo tee /etc/systemd/system/lifeflow-scheduler.timer > /dev/null <<EOF
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
sudo systemctl list-timers lifeflow-scheduler.timer
```

### Option B — cron job

```bash
crontab -e
# Add:
0 * * * * curl -sf -X POST https://YOUR_DOMAIN/api/jobs/process-subscriptions -H "Authorization: Bearer <SCHEDULER_SECRET>" > /dev/null 2>&1
```

---

## 8. Optional: Azure Blob Storage

For production-scale file storage, use Azure Blob Storage instead of MongoDB:

1. Create a Storage Account in the Azure portal
2. Create a private Blob container named `transaction-proofs`
3. In `.env.local`:

```env
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT_NAME=<your-account-name>
AZURE_STORAGE_ACCOUNT_KEY=<your-account-key>
AZURE_STORAGE_CONTAINER=transaction-proofs
```

Or use a Managed Identity (recommended — no keys in env):
- Assign the **Storage Blob Data Contributor** role to the VM's system-assigned identity
- Leave `AZURE_STORAGE_ACCOUNT_KEY` empty

---

## 9. Updates and rollback

### Deploy an update

```bash
cd /opt/lifeflow
git pull origin main
docker compose up -d --build
```

### Rollback

```bash
git checkout <previous-commit-sha>
docker compose up -d --build
```

---

## 10. Monitoring

```bash
# Application logs
docker compose logs -f app

# Health check
curl https://YOUR_DOMAIN/api/health

# NGINX access logs
sudo tail -f /var/log/nginx/access.log

# Resource usage
docker stats lifeflow-app-1
```

---

## 11. Security hardening (production)

- Restrict SSH to your IP: Azure VM → Networking → restrict port 22 to your static IP
- Enable Azure Firewall or NSG to block all other inbound ports
- Enable MongoDB Atlas IP allowlist: add only the VM's public IP (not 0.0.0.0/0)
- Keep packages updated: `sudo apt-get update && sudo apt-get upgrade -y`
- Enable UFW: `sudo ufw allow 80,443/tcp && sudo ufw enable`
