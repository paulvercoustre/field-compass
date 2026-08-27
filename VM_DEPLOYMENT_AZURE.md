# Azure VM Deployment (Simple Demo Setup)

This is the **recommended deployment path for demos / low traffic** while you’re still iterating quickly.

It runs everything on a single VM using Docker Compose:
- Caddy (serves the frontend, proxies `/api/*` to the backend, and obtains
  HTTPS certificates automatically)
- FastAPI backend
- PostgreSQL (local to the VM)
- Redis + a Celery worker for background quality checks

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

```bash
cp .env.example .env
```

Now generate real secrets. **Do not skip this and do not invent the values by
hand** -- the stack will refuse to start if any are missing, which is
deliberate.

Run these three commands on the VM and paste each result into `.env`:

```bash
# JWT_SECRET_KEY -- signs login tokens
openssl rand -hex 32

# ENCRYPTION_KEY -- encrypts stored Kobo tokens (must be a Fernet key)
docker run --rm python:3.11-slim sh -c "pip install -q cryptography && python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"

# POSTGRES_PASSWORD -- database password
openssl rand -base64 24
```

Then edit `.env` so it contains at minimum:

```env
# --- secrets you just generated ---
JWT_SECRET_KEY=<output of openssl rand -hex 32>
ENCRYPTION_KEY=<output of the Fernet command>
POSTGRES_PASSWORD=<output of openssl rand -base64 24>

# --- database (password must match POSTGRES_PASSWORD above) ---
POSTGRES_USER=postgres
POSTGRES_DB=field_compass
DATABASE_URL=postgresql://postgres:<SAME_POSTGRES_PASSWORD>@postgres:5432/field_compass

# --- app ---
ENVIRONMENT=production
LOG_LEVEL=INFO

# nginx serves the frontend and proxies /api to the backend on one origin
CORS_ORIGINS=http://<VM_PUBLIC_IP>
VITE_API_URL=/api

# --- third-party ---
OPENAI_API_KEY=<your key>
```

Lock the file down so only your user can read it:

```bash
chmod 600 .env
```

**Notes**

- `.env` is gitignored. Never commit it, and never paste real secrets into
  the repo, an issue, or a chat.
- Each user supplies their own KoboToolbox token through the UI; it is stored
  encrypted using `ENCRYPTION_KEY`. The global `KOBO_API_TOKEN` is a local
  development convenience and can be left blank here.
- Changing `ENCRYPTION_KEY` later makes already-stored Kobo tokens unreadable
  and users must re-enter them. Changing `JWT_SECRET_KEY` logs everyone out.
  Both are safe to set freshly on a first deployment.

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

## 8) HTTPS

The stack uses Caddy, which obtains and renews Let's Encrypt certificates
automatically -- but **only for a domain name**. Let's Encrypt will not issue a
certificate for a bare IP address.

**With a domain (recommended if real people will log in):**

1. Point an A record at the VM's public IP.
2. Make sure ports 80 and 443 are open in the Azure network security group
   (80 is required for the certificate challenge, not just for redirects).
3. Set in `.env`:

   ```env
   SITE_ADDRESS=https://fieldcompass.example.org
   CORS_ORIGINS=https://fieldcompass.example.org
   ```

4. `docker compose -f docker-compose.prod.yml up -d`

Caddy requests the certificate on first start and redirects HTTP to HTTPS from
then on. Certificates live in the `caddy_data` volume -- do not delete it, or
every deploy re-requests certificates and you will hit Let's Encrypt rate
limits.

**Without a domain (`SITE_ADDRESS=:80`):** the app is served over plain HTTP.
Login passwords and session tokens cross the network in the clear, so treat
this as a demo-only mode and do not create real user accounts on it.
