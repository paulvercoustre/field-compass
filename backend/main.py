"""
Field Compass FastAPI Backend
Main application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import uvicorn
from contextlib import asynccontextmanager

from services.database import init_db
from services.rate_limit import limiter
from routers import submissions, progress, etl, surveys, validation_rules, users, quality, ai
import os

# CORS origins - configurable via environment variable
# For production, set CORS_ORIGINS as comma-separated list: "https://app.example.com,https://www.example.com"
# Defaults to localhost for development
_cors_origins_env = os.getenv("CORS_ORIGINS", "")
if _cors_origins_env:
    # Split by comma and strip whitespace
    ALLOWED_ORIGINS = [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
else:
    # Default to localhost for development
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:3001",  # Fallback when 3000 is in use
        "http://localhost:5173",  # Vite default port
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:5173",
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup/shutdown events.
    """
    # Startup: Initialize database connection
    print("Starting Field Compass API...")
    if init_db():
        print("✓ Database connection established")
    else:
        print("✗ Database connection failed - check configuration")
    
    yield
    
    # Shutdown: Cleanup if needed
    print("Shutting down Field Compass API...")


# Create FastAPI app
app = FastAPI(
    title="Field Compass API",
    description="QA Platform for KoboToolbox Survey Data",
    version="1.0.0",
    lifespan=lifespan,
)

# Rate limiting (protects auth endpoints from credential stuffing and the AI
# endpoints from budget exhaustion)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(submissions.router, prefix="/api", tags=["submissions"])
app.include_router(progress.router, prefix="/api", tags=["progress"])
app.include_router(etl.router, prefix="/api", tags=["etl"])
app.include_router(surveys.router, prefix="/api", tags=["surveys"])
app.include_router(validation_rules.router, prefix="/api", tags=["validation-rules"])
app.include_router(quality.router, prefix="/api", tags=["quality"])
app.include_router(ai.router, prefix="/api", tags=["ai"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Field Compass API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    db_status = init_db()
    return {
        "status": "healthy" if db_status else "unhealthy",
        "database": "connected" if db_status else "disconnected"
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
