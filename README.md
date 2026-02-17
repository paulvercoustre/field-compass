# Field Compass QA Platform

This repository contains the complete codebase for the Field Compass application, a KoboToolbox Quality Assurance and Data Tracking Platform.

## Project Structure

The project is organized as a monorepo with the following directories:

- `/frontend`: React/TypeScript user interface (Vite + React 19). Standalone SPA that communicates with the backend via REST API.
- `/backend`: Python/FastAPI backend server. Handles data processing, business logic, ETL, and serves the API.
- `/backend/database`: PostgreSQL schema and migrations.
- `/deploy`: Production deployment configs (nginx, frontend Dockerfile).

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for frontend development)
- Git

### Running the Application

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd field-compass
   ```

2. **Start all services**:
   ```bash
   make up
   # or
   docker-compose up -d
   ```

3. **Initialize the database** (first time only):
   ```bash
   make setup
   ```

4. **Run the frontend** (in a separate terminal):
   ```bash
   npm install && npm run dev
   ```

5. **Access the services**:
   - Frontend: http://localhost:3000
   - API: http://localhost:8000
   - API Docs (Swagger): http://localhost:8000/docs
   - Database: localhost:5432 (user: postgres, password: postgres, db: field_compass)
   - Redis: localhost:6379 (used by Celery worker for async jobs)

### Development Commands

```bash
# View logs
make logs              # All services (postgres, backend, redis, worker)
make logs-backend      # Backend only
make logs-db           # Database only

# Database access
make db-shell          # PostgreSQL shell

# Run tests
make test              # Run backend tests
make test-cov          # Run tests with coverage
make test-verbose      # Run tests with verbose output

# Restart services
make restart

# Stop services
make down

# Clean everything (removes volumes)
make clean
```

## Development Setup

For running without Docker (PostgreSQL in Docker, backend/frontend local), see [DEVELOPMENT.md](DEVELOPMENT.md).

### Backend Development

The backend runs in a Docker container with hot-reload enabled. Code changes are automatically reflected.

To develop locally without Docker:

1. **Create virtual environment**:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Set environment variables**:
   ```bash
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/field_compass
   ```

4. **Run the server**:
   ```bash
   uvicorn main:app --reload
   ```

### Frontend Development

The frontend runs separately from Docker. With the backend and database running:

1. **Install dependencies** (from project root):
   ```bash
   npm install
   ```

2. **Start the dev server**:
   ```bash
   npm run dev
   ```

3. **Access** at http://localhost:3000. The app uses `VITE_API_URL` (default: `http://localhost:8000`) to talk to the backend. For production builds, set `VITE_API_URL=/api` when using nginx proxy.

## Database

The database schema is automatically created when the PostgreSQL container starts for the first time. The schema file is located at `backend/database/schema.sql`.

### Manual Database Setup

If you need to run the schema manually (e.g. after `make db-shell`):

```bash
# From host (with postgres container running)
psql -h localhost -U postgres -d field_compass -f backend/database/schema.sql

# Or from inside container via make db-shell
\i /docker-entrypoint-initdb.d/01-schema.sql
```

## API Documentation

Once the backend is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Demo Deployment (Azure VM)

For a single-VM production-style deployment (low traffic):

- **`VM_DEPLOYMENT_AZURE.md`** – Azure VM setup instructions
- **`docker-compose.prod.yml`** – nginx (reverse proxy + static frontend), postgres, backend, redis, Celery worker, frontend build

## Environment Variables

**Important**: Create a `.env` file in the root directory before starting the services. This file is excluded from git (see `.gitignore`).

1. **Copy the example file**:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and add your values**:
   ```env
   # Database (default works for Docker Compose)
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/field_compass
   
   # KoboToolbox API (REQUIRED for ETL pipeline)
   # Get your token from: https://kf.kobotoolbox.org/token/
   KOBO_API_TOKEN=your_kobo_api_token_here
   KOBO_API_URL=https://kf.kobotoolbox.org/api/v2
   
   # Application settings
   ENVIRONMENT=development
   LOG_LEVEL=INFO
   
   # OpenAI (for AI-powered rule generation and qualitative checks)
   OPENAI_API_KEY=sk-your-openai-api-key-here
   OPENAI_MODEL=gpt-4o-mini
   OPENAI_MAX_TOKENS=1000
   OPENAI_TEMPERATURE=0.2
   ```

3. **Docker Compose** loads variables from `.env`. Optional vars (`OPENAI_RULE_GEN_MODEL`, `OPENAI_QUAL_CHECK_MODEL`, `CELERY_BROKER_URL`, etc.) have defaults in `docker-compose.yml`.

**Security Note**: Never commit your `.env` file to git. It contains sensitive credentials.

## Testing

**Backend tests** (run with services up):
```bash
make test
```

You can also test manually via:
- Swagger UI at http://localhost:8000/docs
- curl or Postman
- The frontend application

## Troubleshooting

### Database connection errors
- Ensure PostgreSQL container is running: `docker-compose ps`
- Check database logs: `make logs-db`
- Verify DATABASE_URL environment variable

### Backend won't start
- Check backend logs: `make logs-backend`
- Ensure all dependencies are installed
- Verify Python version (3.11+)

### Port already in use
- Change ports in `docker-compose.yml`
- Or stop conflicting services

## Features Implemented

- [x] ETL pipeline (KoboToolbox integration, audit logs, data merging)
- [x] User authentication (registration, login, JWT tokens)
- [x] Per-user Kobo API key management (encrypted)
- [x] Survey configuration management
- [x] Validation rules builder with CRUD API
- [x] **AI-powered rule generation from natural language**
- [x] **AI-suggested validation rules based on form analysis**
- [x] Submission viewer with filters
- [x] Enumerator performance metrics
- [x] Data collection progress tracking
- [x] Edit detection and history tracking
- [x] **Data Quality Overview Dashboard** (metrics, issue trends, status summary)
- [x] Celery worker for async qualitative checks (Redis-backed)
- [x] CI/CD pipeline (GitHub Actions)
- [x] Backend tests (~80 test functions)

## AI-Powered Features

Field Compass includes AI-powered features to simplify validation rule creation:

### Natural Language Rule Generation
Describe your validation rule in plain English, and AI will convert it to a structured rule:
- "Flag if respondent age is greater than 100"
- "Flag any survey completed in under 10 minutes"
- "Check if consent is not given"

### AI Rule Suggestions
AI analyzes your survey form and suggests relevant validation rules based on best practices:
- Range validation for numeric fields
- Required field checks
- Duration anomaly detection
- Date validity checks
- Logical consistency rules

**Setup:** Add your OpenAI API key to `.env`:
```bash
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o-mini
```

## Next Steps

- [ ] Frontend component tests
- [ ] Airflow scheduler for automated ETL
- [ ] Dataset-level quality checks
- [ ] Export functionality (CSV/Excel)

See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for deployment details.

## License

MIT License. See [LICENSE](LICENSE) for details.
