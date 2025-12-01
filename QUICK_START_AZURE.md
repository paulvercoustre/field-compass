# Quick Start: Azure Deployment

## TL;DR - Deploy in 5 Steps

### 1. Create Resources (5 minutes)

```bash
# Login to Azure
az login

# Create resource group
az group create --name field-compass-rg --location eastus

# Create PostgreSQL database
az postgres flexible-server create \
  --resource-group field-compass-rg \
  --name field-compass-db \
  --location eastus \
  --admin-user postgres \
  --admin-password <YOUR_PASSWORD> \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15

# Create database
az postgres flexible-server db create \
  --resource-group field-compass-rg \
  --server-name field-compass-db \
  --database-name field_compass

# Allow Azure services
az postgres flexible-server firewall-rule create \
  --resource-group field-compass-rg \
  --name field-compass-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

### 2. Create App Service (2 minutes)

```bash
# Create plan
az appservice plan create \
  --name field-compass-plan \
  --resource-group field-compass-rg \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --resource-group field-compass-rg \
  --plan field-compass-plan \
  --name field-compass-api \
  --runtime "PYTHON:3.11"
```

### 3. Configure Environment Variables (2 minutes)

```bash
# Get your database connection string (replace <PASSWORD>)
DB_URL="postgresql://postgres:<PASSWORD>@field-compass-db.postgres.database.azure.com:5432/field_compass"

# Configure settings
az webapp config appsettings set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --settings \
    DATABASE_URL="$DB_URL" \
    KOBO_API_TOKEN="<YOUR_KOBO_TOKEN>" \
    KOBO_API_URL="https://kf.kobotoolbox.org/api/v2" \
    ENVIRONMENT="production" \
    LOG_LEVEL="INFO" \
    CORS_ORIGINS="https://<YOUR_FRONTEND_URL>"
```

### 4. Deploy Backend (5 minutes)

```bash
cd backend
zip -r ../backend-deploy.zip . -x "*.pyc" "__pycache__/*" "*.git/*"

az webapp deployment source config-zip \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --src ../backend-deploy.zip
```

### 5. Initialize Database (2 minutes)

```bash
# Run schema
psql "$DB_URL" -f backend/database/schema.sql
```

## Verify Deployment

```bash
# Check health
curl https://field-compass-api.azurewebsites.net/health

# View logs
az webapp log tail --name field-compass-api --resource-group field-compass-rg
```

## Deploy Frontend

### Option 1: Static Web Apps (Easiest)

```bash
# Create Static Web App
az staticwebapp create \
  --name field-compass-app \
  --resource-group field-compass-rg \
  --location eastus2 \
  --sku Free

# Build frontend
npm run build

# Deploy (use deployment token from Azure Portal)
# Or connect to GitHub for automatic deployments
```

### Option 2: Storage Account

```bash
# Create storage
az storage account create \
  --name fieldcompassapp \
  --resource-group field-compass-rg \
  --location eastus \
  --sku Standard_LRS

# Enable static website
az storage blob service-properties update \
  --account-name fieldcompassapp \
  --static-website \
  --404-document index.html \
  --index-document index.html

# Upload
npm run build
az storage blob upload-batch \
  --account-name fieldcompassapp \
  --source dist \
  --destination '$web' \
  --overwrite
```

## Update CORS

After deploying frontend, update backend CORS:

```bash
az webapp config appsettings set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --settings \
    CORS_ORIGINS="https://<YOUR_FRONTEND_URL>"
```

## Cost

Approximate monthly cost: **~$25** (B1 App Service + B1ms PostgreSQL)

## Need Help?

See [azure-deployment.md](azure-deployment.md) for detailed instructions.

