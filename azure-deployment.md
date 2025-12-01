# Azure Deployment Guide for Field Compass

This guide walks you through deploying Field Compass to Azure.

## Architecture Overview

The deployment consists of:
- **Azure App Service** (Linux) - Backend API (FastAPI)
- **Azure Database for PostgreSQL** - Database
- **Azure Static Web Apps** or **Azure Storage + CDN** - Frontend (React)
- **Azure Key Vault** (optional) - For secrets management

## Prerequisites

1. Azure account with active subscription
2. Azure CLI installed: `az --version`
3. Docker (for building images, optional)
4. Your KoboToolbox API token

## Step 1: Create Azure Resources

### 1.1 Create Resource Group

```bash
az group create \
  --name field-compass-rg \
  --location eastus
```

### 1.2 Create PostgreSQL Database

```bash
# Create PostgreSQL server (adjust pricing tier as needed)
az postgres flexible-server create \
  --resource-group field-compass-rg \
  --name field-compass-db \
  --location eastus \
  --admin-user postgres \
  --admin-password <YOUR_SECURE_PASSWORD> \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --storage-size 32

# Create database
az postgres flexible-server db create \
  --resource-group field-compass-rg \
  --server-name field-compass-db \
  --database-name field_compass

# Allow Azure services to access (for App Service)
az postgres flexible-server firewall-rule create \
  --resource-group field-compass-rg \
  --name field-compass-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

**Note**: Save the connection string. Format:
```
postgresql://postgres:<PASSWORD>@field-compass-db.postgres.database.azure.com:5432/field_compass
```

### 1.3 Create App Service Plan

```bash
az appservice plan create \
  --name field-compass-plan \
  --resource-group field-compass-rg \
  --sku B1 \
  --is-linux
```

### 1.4 Create App Service (Backend)

```bash
# Create web app
az webapp create \
  --resource-group field-compass-rg \
  --plan field-compass-plan \
  --name field-compass-api \
  --runtime "PYTHON:3.11"

# Configure environment variables
az webapp config appsettings set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --settings \
    DATABASE_URL="postgresql://postgres:<PASSWORD>@field-compass-db.postgres.database.azure.com:5432/field_compass" \
    KOBO_API_TOKEN="<YOUR_KOBO_TOKEN>" \
    KOBO_API_URL="https://kf.kobotoolbox.org/api/v2" \
    ENVIRONMENT="production" \
    LOG_LEVEL="INFO" \
    CORS_ORIGINS="https://<YOUR_FRONTEND_URL>"

# Enable always on (recommended for production)
az webapp config set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --always-on true

# Set startup command
az webapp config set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --startup-file "uvicorn main:app --host 0.0.0.0 --port 8000"
```

### 1.5 Deploy Backend Code

**Option A: Deploy from Local Git**

```bash
cd backend
az webapp deployment source config-local-git \
  --name field-compass-api \
  --resource-group field-compass-rg

# Follow the instructions to push code
```

**Option B: Deploy via ZIP**

```bash
# Create deployment package
cd backend
zip -r ../backend-deploy.zip . -x "*.pyc" "__pycache__/*" "*.git/*"

# Deploy
az webapp deployment source config-zip \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --src ../backend-deploy.zip
```

**Option C: Deploy via GitHub Actions (Recommended)**

See `.github/workflows/azure-deploy.yml` (create this file)

### 1.6 Initialize Database Schema

After deployment, run the schema:

```bash
# Connect to database and run schema
az postgres flexible-server connect \
  --name field-compass-db \
  --admin-user postgres \
  --admin-password <PASSWORD> \
  --database-name field_compass

# Then run:
# \i backend/database/schema.sql
# Or use psql from your local machine:
psql "postgresql://postgres:<PASSWORD>@field-compass-db.postgres.database.azure.com:5432/field_compass" \
  -f backend/database/schema.sql
```

## Step 2: Deploy Frontend

### Option A: Azure Static Web Apps (Recommended)

```bash
# Create Static Web App
az staticwebapp create \
  --name field-compass-app \
  --resource-group field-compass-rg \
  --location eastus2 \
  --sku Free

# Get deployment token
az staticwebapp secrets list \
  --name field-compass-app \
  --resource-group field-compass-rg

# Build and deploy
npm run build
# Use the deployment token with Static Web Apps CLI or GitHub Actions
```

**Configure environment variable in Azure Portal:**
- Go to Static Web App → Configuration → Application settings
- Add: `VITE_API_URL` = `https://field-compass-api.azurewebsites.net`

### Option B: Azure Storage + CDN

```bash
# Create storage account
az storage account create \
  --name fieldcompassapp \
  --resource-group field-compass-rg \
  --location eastus \
  --sku Standard_LRS \
  --kind StorageV2

# Enable static website hosting
az storage blob service-properties update \
  --account-name fieldcompassapp \
  --static-website \
  --404-document index.html \
  --index-document index.html

# Build frontend
npm run build

# Upload to storage
az storage blob upload-batch \
  --account-name fieldcompassapp \
  --source dist \
  --destination '$web' \
  --overwrite
```

## Step 3: Configure CORS

Update the backend CORS_ORIGINS setting with your frontend URL:

```bash
az webapp config appsettings set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --settings \
    CORS_ORIGINS="https://field-compass-app.azurestaticapps.net"
```

## Step 4: Verify Deployment

1. **Check backend health:**
   ```bash
   curl https://field-compass-api.azurewebsites.net/health
   ```

2. **Check API docs:**
   - Visit: `https://field-compass-api.azurewebsites.net/docs`

3. **Test frontend:**
   - Visit your frontend URL
   - Try creating a survey
   - Test ETL pipeline

## Step 5: Set Up Monitoring (Optional)

### Application Insights

```bash
# Create Application Insights
az monitor app-insights component create \
  --app field-compass-insights \
  --location eastus \
  --resource-group field-compass-rg

# Get instrumentation key
az monitor app-insights component show \
  --app field-compass-insights \
  --resource-group field-compass-rg \
  --query instrumentationKey

# Add to App Service
az webapp config appsettings set \
  --resource-group field-compass-rg \
  --name field-compass-api \
  --settings \
    APPINSIGHTS_INSTRUMENTATION_KEY="<INSTRUMENTATION_KEY>"
```

## Environment Variables Reference

### Backend (App Service)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `KOBO_API_TOKEN` | KoboToolbox API token | `your_token_here` |
| `KOBO_API_URL` | KoboToolbox API base URL | `https://kf.kobotoolbox.org/api/v2` |
| `ENVIRONMENT` | Environment name | `production` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `https://app.example.com` |

### Frontend (Static Web App)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `https://field-compass-api.azurewebsites.net` |

## Troubleshooting

### Backend won't start
- Check logs: `az webapp log tail --name field-compass-api --resource-group field-compass-rg`
- Verify environment variables are set correctly
- Check database connectivity

### CORS errors
- Verify `CORS_ORIGINS` includes your frontend URL
- Check browser console for exact error
- Ensure no trailing slashes in URLs

### Database connection issues
- Verify firewall rules allow Azure services
- Check connection string format
- Test connection from local machine first

### Frontend can't reach backend
- Verify `VITE_API_URL` is set correctly
- Check backend is running: `/health` endpoint
- Verify CORS is configured

## Cost Estimation

Approximate monthly costs (varies by region and usage):

- **App Service (B1)**: ~$13/month
- **PostgreSQL Flexible Server (B1ms)**: ~$12/month
- **Static Web Apps (Free tier)**: $0
- **Total**: ~$25/month (basic setup)

## Next Steps

1. Set up CI/CD pipeline (GitHub Actions)
2. Configure custom domain
3. Set up automated backups for database
4. Add monitoring and alerting
5. Implement authentication (when ready)

## Security Notes

⚠️ **Important**: This deployment does NOT include authentication. Consider:

1. **Network-level security**: Use Azure Private Endpoints
2. **IP restrictions**: Restrict App Service access to specific IPs
3. **HTTPS only**: Enforce HTTPS in App Service settings
4. **Secrets management**: Use Azure Key Vault for sensitive values
5. **Regular updates**: Keep dependencies updated

## Support

For issues or questions:
- Check application logs in Azure Portal
- Review Azure App Service diagnostics
- Check database connection in Azure Portal

