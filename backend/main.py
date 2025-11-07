"""
Field Compass FastAPI Backend
Main application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from contextlib import asynccontextmanager

from services.database import init_db
from routers import submissions, progress, etl

# CORS origins - update for production
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",  # Vite default port
    "http://127.0.0.1:3000",
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

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(submissions.router, prefix="/api", tags=["submissions"])
app.include_router(progress.router, prefix="/api", tags=["progress"])
app.include_router(etl.router, prefix="/api", tags=["etl"])


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
