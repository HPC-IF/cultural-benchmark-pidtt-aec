#!/bin/bash
# CiteCCA Staging LXC Container Setup Script
# Creates and configures LXC container 1001 for the CiteCCA staging frontend

set -euo pipefail

# ─── Load environment variables ──────────────────────────────────────
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
  echo "[env] Loaded secrets from .env"
else
  echo "[env] No .env found — using defaults"
fi

# ─── Configuration (from env or defaults) ────────────────────────────
CONTAINER_ID=${CONTAINER_ID:-1001}
TEMPLATE="local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst"
HOSTNAME=${LXC_HOSTNAME:-"citecca-website"}
IP=${LXC_IP:-"192.168.1.200"}
GATEWAY=${LXC_GATEWAY:-"192.168.1.1"}
BRIDGE=${LXC_BRIDGE:-"vmbr0"}
ROOTFS_STORAGE=${LXC_ROOTFS_STORAGE:-"local-lvm"}
ROOTFS_SIZE=${LXC_ROOTFS_SIZE:-"20"}
MEMORY=${LXC_MEMORY:-"2048"}
CORES=${LXC_CORES:-"2"}
PASSWORD=${LXC_PASSWORD:-""}

if [[ -z "$PASSWORD" ]]; then
  echo "ERROR: LXC_PASSWORD is not set. Create .env from .env.example"
  exit 1
fi

echo "============================================"
echo "  CiteCCA LXC Container Setup"
echo "  Container ID: $CONTAINER_ID"
echo "  Hostname: $HOSTNAME"
echo "  IP: $IP/24"
echo "  OS: Debian 12 (Bookworm)"
echo "============================================"

# Check if container already exists
if pct status $CONTAINER_ID &>/dev/null; then
    echo ""
    echo "WARNING: Container $CONTAINER_ID already exists!"
    read -p "Destroy and recreate? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        pct stop $CONTAINER_ID 2>/dev/null || true
        pct destroy $CONTAINER_ID
        echo "Container destroyed. Recreating..."
    else
        echo "Aborting. Container already exists."
        exit 0
    fi
fi

# Step 1: Create the container
echo ""
echo "[1/7] Creating container $CONTAINER_ID..."
pct create $CONTAINER_ID $TEMPLATE \
    --hostname $HOSTNAME \
    --ostype debian \
    --arch amd64 \
    --cores $CORES \
    --memory $MEMORY \
    --rootfs $ROOTFS_STORAGE:$ROOTFS_SIZE \
    --net0 "name=eth0,bridge=$BRIDGE,ip=$IP/24,gw=$GATEWAY" \
    --password "$PASSWORD" \
    --unprivileged 0 \
    --swap 512 \
    --features nesting=1

echo "Container created successfully."

# Step 2: Start the container
echo ""
echo "[2/7] Starting container..."
pct start $CONTAINER_ID
echo "Waiting for container to boot..."
sleep 5

# Verify it's running
STATUS=$(pct status $CONTAINER_ID)
if echo "$STATUS" | grep -q "running"; then
    echo "Container is running."
else
    echo "ERROR: Container failed to start. Status: $STATUS"
    exit 1
fi

# Step 3: Update system packages
echo ""
echo "[3/7] Updating system packages..."
pct exec $CONTAINER_ID -- bash -c "apt-get update && apt-get upgrade -y -o Dpkg::Options::=\"--force-confdef\" -o Dpkg::Options::=\"--force-confold\"" >/dev/null 2>&1
echo "System packages updated."

# Step 4: Install prerequisites
echo ""
echo "[4/7] Installing prerequisites (curl, git, gnupg)..."
pct exec $CONTAINER_ID -- bash -c "apt-get install -y curl git gnupg ca-certificates lsb-release" >/dev/null 2>&1
echo "Prerequisites installed."

# Step 5: Install Node.js and PM2
echo ""
echo "[5/7] Installing Node.js 20.x and PM2..."
pct exec $CONTAINER_ID -- bash -c "
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
" >/dev/null 2>&1

NODE_VER=$(pct exec $CONTAINER_ID -- node --version)
NPM_VER=$(pct exec $CONTAINER_ID -- npm --version)
echo "Node.js: $NODE_VER"
echo "npm: $NPM_VER"
echo "PM2 installed."

# Step 6: Install Nginx
echo ""
echo "[6/7] Installing Nginx..."
pct exec $CONTAINER_ID -- apt-get install -y nginx >/dev/null 2>&1
echo "Nginx installed."

# Step 7: Configure Nginx reverse proxy
echo ""
echo "[7/7] Configuring Nginx reverse proxy..."
pct exec $CONTAINER_ID -- bash -c "
rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/citecca << 'NGINX_EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection \"1; mode=block\" always;

    # Logging
    access_log /var/log/nginx/citecca_access.log;
    error_log /var/log/nginx/citecca_error.log;

    # Proxy to Node.js app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_redirect off;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control \"public, immutable\";
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/citecca /etc/nginx/sites-enabled/citecca
nginx -t && systemctl reload nginx
" 2>&1
echo "Nginx configured and running."

echo ""
echo "============================================"
echo "  Container setup complete!"
echo "============================================"
echo ""
echo "Container $CONTAINER_ID is ready for deployment."
echo ""
echo "Next steps:"
echo "  1. Deploy the website: cd /opt/citecca-deploy && ./deploy.sh"
echo "  2. Verify: curl -sI http://$IP/"
echo ""
echo "Container details:"
echo "  - IP: $IP"
echo "  - Hostname: $HOSTNAME"
echo "  - Root password: $PASSWORD"
echo "  - SSH: ssh root@$IP"
echo ""
echo "To enter the container: pct exec $CONTAINER_ID -- bash"
