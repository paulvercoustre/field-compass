# CI/CD Workflows

This directory contains GitHub Actions workflows for continuous integration and deployment.

## Workflows

### `ci-cd.yml` - Main CI/CD Pipeline

This workflow runs on:
- Pushes to `main` and `develop` branches
- Pull requests to `main` and `develop` branches
- Manual trigger via `workflow_dispatch`

#### Pipeline Stages

1. **Test & Lint** (Job: `test-and-lint`)
   - Runs unit tests with pytest
   - Lints code with ruff
   - Checks code formatting
   - Generates coverage reports
   - **Duration**: ~1-2 minutes

2. **Build Docker Image** (Job: `build-docker`)
   - Builds Docker image from `backend/Dockerfile`
   - Pushes to GitHub Container Registry (GHCR)
   - Tags images based on branch/PR
   - Uses Docker layer caching for faster builds
   - **Duration**: ~2-3 minutes

3. **Test in Docker** (Job: `test-in-docker`)
   - Pulls the built Docker image
   - Starts PostgreSQL service container
   - Runs health check tests inside container
   - Verifies database connectivity
   - **Duration**: ~1-2 minutes

4. **Deploy**
   - Deployment is intentionally not handled by this workflow right now.
   - For demos/low-traffic environments we deploy via **Azure VM + Docker Compose** (see `VM_DEPLOYMENT_AZURE.md`).

#### Image Tagging Strategy

Images are tagged based on context:
- **Main branch**: `main`, `main-<sha>`, `latest`
- **PRs**: `pr-<number>`
- **Other branches**: `<branch-name>`, `<branch-name>-<sha>`

#### Required Secrets

- None for deployment (CI only). Docker images are pushed to GHCR using `GITHUB_TOKEN`.

#### Required Permissions

The workflow needs:
- `contents: read` - Read repository code
- `packages: write` - Push Docker images to GHCR

These are automatically granted via `GITHUB_TOKEN`.

## Docker Images

Docker images are stored in GitHub Container Registry:
- Registry: `ghcr.io`
- Image: `ghcr.io/<owner>/<repo>/field-compass-backend`

To pull an image locally:
```bash
docker pull ghcr.io/<owner>/<repo>/field-compass-backend:latest
```

## Local Testing

To test the workflow locally:

1. **Run linting:**
   ```bash
   cd backend
   ruff check .
   ruff format --check .
   ```

2. **Run tests:**
   ```bash
   cd backend
   pytest tests/ -v
   ```

3. **Build Docker image:**
   ```bash
   cd backend
   docker build -t field-compass-backend .
   ```

4. **Test Docker container:**
   ```bash
   docker run -p 8000:8000 \
     -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
     field-compass-backend
   ```

## Troubleshooting

### Tests fail in Docker but pass locally
- Check environment variables are set correctly
- Verify database connection string format
- Check container logs: `docker logs <container-id>`

### Docker build fails
- Check Dockerfile syntax
- Verify all dependencies in `requirements.txt`
- Check for missing system dependencies

### Deployment notes
- For VM-based deployment, you pull the latest GHCR image (or rebuild on the VM) and restart compose.

## Workflow Status

View workflow runs at:
`https://github.com/<owner>/<repo>/actions`

## Modifying the Workflow

When modifying the workflow:
1. Test changes in a feature branch first
2. Use `workflow_dispatch` to test manually
3. Check workflow logs for errors
4. Update this README if adding new jobs/steps



