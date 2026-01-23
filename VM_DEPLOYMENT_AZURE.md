# Azure VM Deployment (Simple Demo Setup)

This is the **recommended deployment path for demos / low traffic** while you’re still iterating quickly.

It runs everything on a single VM using Docker Compose:
- Nginx (serves frontend + proxies `/api/*` to backend)
- FastAPI backend
- PostgreSQL (local to the VM)

## 0) Cost Note

This setup costs roughly **one VM + disk** (and optionally a public IP). It’s often cheaper than managed Postgres + App Service for low traffic.

To stop costs: **stop/deallocate the VM** (or delete the resource group).

## 1) Create an Ubuntu VM

In Azure Portal:
- Create VM (Ubuntu 22.04 LTS)
- Size: smallest acceptable (e.g. B1s/B2s)
- Open inbound ports:
  - 22 (SSH)
  - 80 (HTTP)
  - 443 (HTTPS) (recommended once you add TLS)

## 2) SSH into the VM

```bash
ssh azureuser@<VM_PUBLIC_IP>
```

## 3) Install Docker + Compose

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker
```

Verify:

```bash
docker version
docker compose version
```

## 4) Get the code onto the VM

Option A (simple): clone the repo

```bash
sudo apt-get install -y git
git clone https://github.com/<owner>/field-compass.git
cd field-compass
```

## 5) Configure environment variables

Create a `.env` file for production:

```bash
cp .env.example .env
```

Set at least:
- `POSTGRES_PASSWORD` (strong)
- `DATABASE_URL` (should match your local Postgres service in compose)
- `CORS_ORIGINS` (your domain/IP)

Example values:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<STRONG_PASSWORD>
POSTGRES_DB=field_compass

DATABASE_URL=postgresql://postgres:<STRONG_PASSWORD>@postgres:5432/field_compass
ENVIRONMENT=production
LOG_LEVEL=INFO

# Nginx serves frontend and proxies /api to backend on the same origin
CORS_ORIGINS=http://<VM_PUBLIC_IP>,https://<YOUR_DOMAIN>

# Frontend talks to /api through nginx
VITE_API_URL=/api
```

## 6) Start the production stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check:

```bash
docker ps
curl http://localhost/health
```

From your laptop:
- Open `http://<VM_PUBLIC_IP>/`

## 7) Updating the deployment

```bash
cd field-compass
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 8) HTTPS (recommended)

For demos, you can add TLS later. Easiest: replace nginx with Caddy (auto HTTPS) or use certbot with nginx.

