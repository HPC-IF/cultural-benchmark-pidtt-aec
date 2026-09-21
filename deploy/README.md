# CiteCCA Staging Deployment Infrastructure

## Overview
This folder contains scripts and documentation for deploying the CiteCCA website to LXC container 1001.
The frontend is a React + Vite application served via Express and Nginx. No backend services are used — this is a static frontend staging environment.

## Container Information
- **Container ID**: 1001
- **Hostname**: citecca-website
- **OS**: Debian 12 (Bookworm)
- **IP Address**: 192.168.1.200/24
- **Gateway**: 192.168.1.1
- **Resources**: 2 cores, 2GB RAM, 20GB disk
- **Status**: Running

## Services
### Frontend (React + Vite + Express)
- **Type**: React 18 SPA built with Vite, served by Express
- **Location**: `/opt/citecca-website/` (inside container 1001)
- **Deployment**: Via `deploy.sh` script from this directory
- **Started with**: PM2 process manager (2 instances, cluster mode)
- **Port**: 3000 (internal), proxied via Nginx on port 80

### Nginx Reverse Proxy
- **Type**: Nginx
- **Config**: `/etc/nginx/sites-available/citecca`
- **Proxies**: `:80` → `127.0.0.1:3000`
- **SSL**: Not configured (staging, HTTP only)
- **Security headers**: X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, X-XSS-Protection

## Directory Structure

### Deployment Scripts (this directory: `/opt/citecca-deploy/`)
```
citecca-deploy/
├── deploy.sh              # Deploys frontend to container 1001
├── setup-lxc.sh           # Creates and configures LXC container 1001
├── README.md              # This documentation
├── .env                   # Environment variables (do not commit)
├── .env.example           # Template for .env
└── .gitignore
```

### Inside Container 1001
```
/opt/citecca-website/          # Deployed frontend application
├── dist/                      # Vite build output (static files)
├── server.js                  # Express entry point
├── ecosystem.config.cjs       # PM2 configuration
├── package.json               # Server dependencies
├── .nvmrc                     # Node.js version pin (20)
└── node_modules/

/etc/nginx/sites-available/citecca  # Nginx reverse proxy config
```

## Prerequisites
- Container 1001 running (Debian 12)
- Nginx installed and configured
- Node.js 20.x and PM2 installed
- Git available for cloning the source repo

## Deployment Steps

### 1. Create Container (first time setup)
```bash
cd /opt/citecca-deploy
./setup-lxc.sh
```
This script creates LXC container 1001 with:
- Debian 12 template
- 2 cores, 2GB RAM, 20GB disk
- IP 192.168.1.200/24 on bridge vmbr0
- Node.js 20.x, PM2, and Nginx pre-installed

### 2. Deploy Frontend
```bash
cd /opt/citecca-deploy
./deploy.sh
```
This script:
- Clones the source repo from `/home/git/repositories/website.git`
- Builds the Vite production bundle locally
- Creates a backup of the current deployment
- Copies build artifacts to container 1001
- Installs server dependencies (npm ci --omit=dev)
- Reloads PM2 (zero-downtime)
- Runs a health check with automatic rollback on failure

### 3. Verify Deployment
```bash
curl -sI http://192.168.1.200/
# Should return HTTP 200
```

## Nginx Configuration
- **Sites config**: `/etc/nginx/sites-available/citecca`
- **Proxies**: `:80` → `127.0.0.1:3000` (Express/PM2)
- **No SSL**: This is a staging environment, HTTP only
- **Security headers**: X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, X-XSS-Protection
- **Static asset caching**: 30 days for JS/CSS/image assets

## Troubleshooting

### Container Issues
```bash
pct status 1001                          # Check container status
pct logs 1001                            # View container logs
pct exec 1001 -- bash                    # Enter container
```

### Frontend Issues
```bash
pct exec 1001 -- pm2 list                # Check PM2 processes
pct exec 1001 -- pm2 logs citecca-website  # View app logs
pct exec 1001 -- systemctl status nginx   # Check Nginx
```

### Nginx Issues
```bash
pct exec 1001 -- nginx -t                # Test Nginx config
pct exec 1001 -- systemctl reload nginx   # Reload Nginx
pct exec 1001 -- tail -20 /var/log/nginx/citecca_error.log
```

## Notes
- Container uses Debian 12 (Bookworm)
- Frontend is a React + Vite SPA deployed via Express
- PM2 runs 2 cluster instances for zero-downtime reloads
- Nginx handles reverse proxying and static asset caching
- No backend services — this is a frontend-only staging environment
- Deploy script includes automatic rollback on health check failure (keeps last 3 backups)
- All services run inside container 1001, exposed via Nginx on port 80

## Quick Reference Commands

### On Host
```bash
cd /opt/citecca-deploy && ./deploy.sh     # Deploy frontend
```

### Inside Container 1001
```bash
pm2 list                                  # Check frontend app
pm2 logs citecca-website                   # View app logs
nginx -t                                  # Test Nginx config
systemctl reload nginx                      # Reload Nginx
```
