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
VITE_API_URL=

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

## 9) Automatic deploys from CI

Pushes to `main` deploy themselves once `test-and-lint`, `build-docker` and
`test-in-docker` have all passed (see `.github/workflows/ci-cd.yml`). A failure
anywhere upstream skips the deploy entirely.

The pipeline SSHes in as a dedicated key that is **pinned to the deploy script
by a forced command**, so it cannot open a shell or run anything else. If that
key ever leaks, the only thing it can do is deploy a commit that is already on
`origin/main`.

### One-time setup

**On the VM** -- install the script and authorise the CI key:

```bash
sudo install -m 755 -o root -g root \
  ~/field-compass/deploy/vm/deploy.sh /usr/local/bin/field-compass-deploy

# Paste the CI public key here. `restrict` disables port/agent forwarding,
# PTY allocation and X11; `command=` forces the deploy script regardless of
# what the client asks for.
cat >> ~/.ssh/authorized_keys <<'KEY'
command="/usr/local/bin/field-compass-deploy",restrict ssh-ed25519 AAAA...  github-actions-deploy@field-compass
KEY

chmod 600 ~/.ssh/authorized_keys
```

The script must be owned by root and not writable by `azureuser`, or the forced
command could be rewritten by anyone who compromises that account.

**In GitHub** -- three variables and one secret
(Settings -> Secrets and variables -> Actions):

| Kind | Name | Value |
|---|---|---|
| Variable | `VM_HOST` | the VM's public IP |
| Variable | `VM_USER` | `azureuser` |
| Variable | `VM_SSH_KNOWN_HOSTS` | output of `ssh-keyscan <VM_IP>`, verified out of band |
| Secret | `VM_SSH_PRIVATE_KEY` | the CI private key, whole file including header/footer |

Verify `VM_SSH_KNOWN_HOSTS` against a fingerprint you trust before saving it --
pinning a key you scanned over an untrusted network pins the attacker's key.
Compare with `ssh-keygen -lf` output from a machine that has already connected.

### What a deploy does

1. Fetches `origin` and checks out **the exact commit CI tested**, not whatever
   `main` points at by then.
2. `docker compose -f docker-compose.prod.yml up -d --build`.
   The rebuild is required: `VITE_API_URL` is baked into the frontend bundle at
   build time, so a restart alone would ship the previous bundle.
3. Polls `/health` from inside the VM for up to 90s.
4. **Rolls back to the previous commit** if that check fails, then fails the
   job. If the rollback is also unhealthy the job says so loudly -- that is the
   case that needs a human.
5. The workflow then re-checks `/health` from outside, confirming the site is
   reachable to the internet and not just to itself.

Deploys are serialised (`concurrency: deploy-production`) and queue rather than
cancel, so two quick pushes cannot build on the VM at the same time.

### Adding a manual approval gate

The job runs in a `production` environment. To require sign-off before any
deploy, add a required reviewer under Settings -> Environments -> production;
the job will then pause and wait rather than deploying on green.

### Rolling back by hand

```bash
ssh azureuser@<VM_PUBLIC_IP>
cd field-compass && git checkout <known-good-sha>
docker compose -f docker-compose.prod.yml up -d --build
```

### Moving to keyless deploys later

The SSH key is the weak point: it is long-lived, and port 22 must stay open to
the internet because GitHub's runner IP ranges are too broad to allowlist. If
this grows past a demo -- a real domain, real accounts -- swap the deploy step
for Azure OIDC (`azure/login` + `az vm run-command invoke`) with a federated
credential pinned to `repo:<owner>/field-compass:ref:refs/heads/main`. That
stores no secret, and lets you close port 22 entirely. Only the one step
changes; the VM script and everything else stays as it is.
