.PHONY: help up down restart logs db-shell api-shell test clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start all services
	@echo "Checking Docker..."
	@docker ps > /dev/null 2>&1 || (echo "Error: Docker is not running. Please start Docker Desktop and try again." && exit 1)
	docker-compose up -d

down: ## Stop all services
	docker-compose down

restart: ## Restart all services
	docker-compose restart

logs: ## Show logs from all services
	docker-compose logs -f

logs-backend: ## Show backend logs
	docker-compose logs -f backend

logs-db: ## Show database logs
	docker-compose logs -f postgres

db-shell: ## Open PostgreSQL shell
	docker-compose exec postgres psql -U postgres -d field_compass

api-shell: ## Open Python shell in backend container
	docker-compose exec backend python

test: ## Run all tests
	docker-compose exec backend pytest

test-cov: ## Run tests with coverage report
	docker-compose exec backend pytest --cov=. --cov-report=term-missing

test-verbose: ## Run tests with verbose output
	docker-compose exec backend pytest -v

clean: ## Remove all containers and volumes
	docker-compose down -v
	docker system prune -f

setup: ## Initial setup - create database schema
	@echo "Checking Docker..."
	@docker ps > /dev/null 2>&1 || (echo "Error: Docker is not running. Please start Docker Desktop and try again." && exit 1)
	docker-compose up -d postgres
	@echo "Waiting for PostgreSQL to be ready..."
	sleep 5
	docker-compose exec -T postgres psql -U postgres -d field_compass -f /docker-entrypoint-initdb.d/01-schema.sql || echo "Schema may already exist"
	@echo "✓ Database setup complete"

