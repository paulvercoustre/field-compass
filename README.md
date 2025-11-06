# Field Compass QA Platform

This repository contains the complete codebase for the Field Compass application, a KoboToolbox Quality Assurance and Data Tracking Platform.

## Project Structure

The project is organized as a monorepo with two primary directories:

- `/frontend`: Contains the React/TypeScript user interface. This is a standalone single-page application that communicates with the backend via a REST API.
- `/backend`: Contains the Python/FastAPI backend server. It handles data processing, business logic, and serves the API for the frontend.
- `/backend/database`: Contains PostgreSQL schema and database setup files.
- `/hfc`: Legacy R code for reference (not part of main codebase, excluded from git).

## Quick Start

### Prerequisites

- Docker and Docker Compose
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

4. **Access the services**:
   - API: http://localhost:8000
   - API Docs (Swagger): http://localhost:8000/docs
   - Database: localhost:5432 (user: postgres, password: postgres, db: field_compass)

### Development Commands

```bash
# View logs
make logs              # All services
make logs-backend      # Backend only
make logs-db           # Database only

# Database access
make db-shell          # PostgreSQL shell

# Restart services
make restart

# Stop services
make down

# Clean everything (removes volumes)
make clean
```

## Development Setup

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

See `/frontend/README.md` for frontend-specific instructions.

## Database

The database schema is automatically created when the PostgreSQL container starts for the first time. The schema file is located at `backend/database/schema.sql`.

### Manual Database Setup

If you need to set up the database manually:

```bash
# Connect to database
make db-shell

# Or using psql directly
psql -h localhost -U postgres -d field_compass

# Run schema
\i backend/database/schema.sql
```

## API Documentation

Once the backend is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Environment Variables

Create a `.env` file in the root directory (see `.env.example` for template):

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/field_compass
KOBO_API_TOKEN=your_token_here
KOBO_API_URL=https://kf.kobotoolbox.org/api/v2
ENVIRONMENT=development
LOG_LEVEL=INFO
```

## Testing

Tests will be added in a future update. For now, you can test the API using:
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

## Next Steps

- [ ] Implement ETL pipeline components
- [ ] Add Airflow scheduler setup
- [ ] Connect frontend to real API
- [ ] Add authentication/authorization
- [ ] Implement survey configuration management
- [ ] Add comprehensive tests

## License

[Add your license here]
