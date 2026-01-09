# Deployment Checklist

Use this checklist to ensure all deployment steps are completed.

## Pre-Deployment

### Code Readiness
- [x] Security vulnerability fixed (eval() → simpleeval)
- [x] User authentication system implemented
- [x] Per-user Kobo API key management (encrypted)
- [x] CI/CD pipeline with automated tests
- [ ] Code reviewed and tested locally
- [ ] All environment variables documented
- [ ] Database migrations tested

### Azure Setup
- [ ] Azure account and subscription ready
- [ ] Azure CLI installed and logged in
- [ ] Resource group created
- [ ] PostgreSQL database created and configured
- [ ] Database schema initialized
- [ ] App Service plan created
- [ ] App Service (backend) created
- [ ] Static Web App or Storage account created (frontend)

### Configuration
- [ ] Backend environment variables configured:
  - [ ] `DATABASE_URL` (PostgreSQL connection string)
  - [ ] `KOBO_API_TOKEN` (KoboToolbox API token)
  - [ ] `KOBO_API_URL` (default: `https://kf.kobotoolbox.org/api/v2`)
  - [ ] `ENVIRONMENT` (set to `production`)
  - [ ] `LOG_LEVEL` (set to `INFO` or `WARNING`)
  - [ ] `CORS_ORIGINS` (frontend URL(s), comma-separated)
- [ ] Frontend environment variable configured:
  - [ ] `VITE_API_URL` (backend API URL)

### Security
- [ ] Database firewall rules configured
- [ ] Strong database password set
- [ ] Secrets stored securely (not in code)
- [ ] HTTPS enforced (Azure default)
- [ ] CORS configured correctly

## Deployment

### Backend
- [ ] Code deployed to App Service
- [ ] Health check endpoint working: `/health`
- [ ] API docs accessible: `/docs`
- [ ] Database connection verified
- [ ] Application logs reviewed (no errors)

### Frontend
- [ ] Frontend built successfully (`npm run build`)
- [ ] Frontend deployed to Static Web App or Storage
- [ ] `VITE_API_URL` environment variable set
- [ ] Frontend loads without errors
- [ ] API calls from frontend working

### Integration Testing
- [ ] Can access frontend URL
- [ ] Can create a survey
- [ ] Can view submissions
- [ ] ETL pipeline can be triggered
- [ ] Data appears correctly in UI
- [ ] No CORS errors in browser console

## Post-Deployment

### Monitoring
- [ ] Application Insights configured (optional)
- [ ] Logging working correctly
- [ ] Health check monitoring set up
- [ ] Error alerts configured (optional)

### Documentation
- [ ] Deployment URL documented
- [ ] Environment variables documented
- [ ] Access credentials stored securely
- [ ] Team notified of deployment

### Backup & Recovery
- [ ] Database backup strategy defined
- [ ] Backup schedule configured (Azure automated backups)
- [ ] Recovery procedure documented

## Optional Enhancements

- [ ] CI/CD pipeline configured (GitHub Actions)
- [ ] Custom domain configured
- [ ] SSL certificate configured (if custom domain)
- [ ] IP restrictions configured (if needed)
- [ ] Performance monitoring set up
- [ ] Cost monitoring/alerts configured

## Rollback Plan

If deployment fails:
1. [ ] Document the issue
2. [ ] Check application logs
3. [ ] Verify environment variables
4. [ ] Test database connectivity
5. [ ] Rollback to previous deployment if needed
6. [ ] Fix issues and redeploy

## Notes

- **Authentication**: ✅ Fully implemented with JWT tokens, user registration, and login.
- **Kobo API Keys**: ✅ Per-user encrypted storage (no longer uses global ENV variable).
- **Testing**: ~60 automated tests in backend. Frontend tests not yet implemented.
- **Monitoring**: Basic health checks only. Consider Application Insights for production.

---

**Last Updated**: January 2025
**Deployed By**: ________________
**Deployment Date**: ________________

