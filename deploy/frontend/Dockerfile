FROM node:22-alpine AS build

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build-time API URL for the frontend (defaults to /api via nginx proxy)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# This image is used only to copy /app/dist to a volume in docker-compose.prod.yml
CMD ["sh", "-c", "ls -la /app/dist && echo 'Build complete'"]

