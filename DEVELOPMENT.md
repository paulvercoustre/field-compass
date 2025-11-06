# Development Guide

## Docker Setup

### Starting Docker Desktop

**On macOS:**
1. Open Docker Desktop application
2. Wait for Docker to start (whale icon in menu bar should be steady)
3. Verify it's running: `docker ps` should work without errors

**On Linux:**
- Docker daemon should start automatically
- If not: `sudo systemctl start docker`

### Troubleshooting Docker Issues

If you get "Cannot connect to the Docker daemon":
1. **Check if Docker Desktop is running** (macOS/Windows)
   - Look for Docker icon in menu bar/taskbar
   - If not running, start Docker Desktop application

2. **Verify Docker is accessible:**
   ```bash
   docker ps
   ```
   Should return a list (even if empty), not an error.

3. **Restart Docker Desktop** if issues persist

## Running Without Docker (Local Development)

If you prefer to run services locally without Docker:

### Option 1: PostgreSQL in Docker, Backend Local

1. **Start only PostgreSQL:**
   ```bash
   docker-compose up -d postgres
   ```

2. **Set up Python environment:**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Set environment variable:**
   ```bash
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/field_compass
   ```

4. **Initialize database:**
   ```bash
   # Wait for PostgreSQL to be ready
   sleep 5
   
   # Run schema
   psql -h localhost -U postgres -d field_compass -f database/schema.sql
   # Or use the docker exec method:
   docker-compose exec -T postgres psql -U postgres -d field_compass < backend/database/schema.sql
   ```

5. **Run backend:**
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

### Option 2: Everything Local (PostgreSQL installed locally)

1. **Install PostgreSQL locally:**
   ```bash
   # macOS
   brew install postgresql@15
   brew services start postgresql@15
   
   # Linux
   sudo apt-get install postgresql-15
   sudo systemctl start postgresql
   ```

2. **Create database:**
   ```bash
   createdb field_compass
   psql field_compass < backend/database/schema.sql
   ```

3. **Set environment variable:**
   ```bash
   export DATABASE_URL=postgresql://localhost:5432/field_compass
   ```

4. **Run backend:**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

## Quick Start (Recommended)

**If Docker is working:**
```bash
make up          # Start all services
make setup       # Initialize database (first time only)
```

**If Docker is not working:**
```bash
# Start just PostgreSQL in Docker
docker-compose up -d postgres

# Run backend locally (see Option 1 above)
```

## Testing the Setup

Once services are running:

1. **Test database connection:**
   ```bash
   python backend/test_setup.py
   ```

2. **Test API:**
   - Visit: http://localhost:8000/docs
   - Or: `curl http://localhost:8000/health`

3. **Check logs:**
   ```bash
   make logs-backend
   # or
   docker-compose logs -f backend
   ```

## Common Issues

### "Cannot connect to Docker daemon"
- **Solution:** Start Docker Desktop (macOS/Windows) or Docker service (Linux)

### "Port 5432 already in use"
- **Solution:** Another PostgreSQL instance is running
  - Stop it: `brew services stop postgresql` (macOS) or change port in docker-compose.yml

### "Port 8000 already in use"
- **Solution:** Another service is using port 8000
  - Change port in docker-compose.yml or stop the conflicting service

### "Module not found" errors
- **Solution:** Install dependencies:
  ```bash
  cd backend
  pip install -r requirements.txt
  ```

### Database connection errors
- **Solution:** 
  1. Check PostgreSQL is running: `docker-compose ps`
  2. Check DATABASE_URL environment variable
  3. Verify database exists: `make db-shell` then `\dt`

