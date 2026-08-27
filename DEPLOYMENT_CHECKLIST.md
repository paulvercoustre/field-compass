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

### Azure Setup (VM Demo Deployment)
- [ ] Azure account and subscription ready
- [ ] Resource group created
- [ ] Ubuntu VM created (ports 22/80/443 -- port 80 is required for
      Let's Encrypt certificate challenges, not just redirects)
- [ ] Docker + docker compose installed on VM
- [ ] Repo deployed to VM
- [ ] `docker-compose.prod.yml` running (caddy + backend + postgres + redis + worker + frontend build)
- [ ] Basic backup approach for postgres volume documented (even for demos)

### Configuration
- [ ] VM `.env` configured:
  - [ ] `POSTGRES_PASSWORD` (strong password)
  - [ ] `DATABASE_URL` (points to `postgres` service in compose)
  - [ ] `ENVIRONMENT` (`production`)
  - [ ] `LOG_LEVEL`
  - [ ] `CORS_ORIGINS` (your domain/IP)
  - [ ] `VITE_API_URL` (`/api` when served through nginx)

### Security
- [ ] Database firewall rules configured
- [ ] Strong database password set
- [ ] Secrets stored securely (not in code)
- [ ] HTTPS enforced (NOT automatic -- requires a DOMAIN in `SITE_ADDRESS`;
      there is no Azure component in front of this VM. With a bare IP the
      app is plain HTTP and passwords travel in clear. See VM_DEPLOYMENT_AZURE.md section 8)
- [ ] CORS configured correctly

## Deployment

### Backend
- [ ] Containers started
- [ ] Health check endpoint working: `http://<VM_IP>/health`
- [ ] API docs accessible: `http://<VM_IP>/docs`
- [ ] Database connection verified
- [ ] Container logs reviewed (no errors)

### Frontend
- [ ] Frontend builds successfully via `docker-compose.prod.yml`
- [ ] Frontend loads without errors at `http://<VM_IP>/`
- [ ] API calls from frontend working (`/api/*`)

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

