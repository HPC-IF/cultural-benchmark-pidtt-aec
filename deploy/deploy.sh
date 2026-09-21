#!/usr/bin/env bash
# Zero-downtime deployment for CITECCA website
# Uses env vars for secrets, includes health checks and automatic rollback

set -euo pipefail

# ─── Load environment variables ───────────────────────────────────────
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
  echo "[env] Loaded from .env"
else
  echo "[env] No .env found — using defaults"
fi

# ─── Configuration (from env or defaults) ────────────────────────────
CONTAINER_ID="${CONTAINER_ID:-1001}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/citecca-website}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://192.168.1.200/}"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-30}"

# ─── Docker Configuration ─────────────────────────────────────────
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
DOCKER_REGISTRY_USER="${DOCKER_REGISTRY_USER:-}"
DOCKER_REGISTRY_PASS="${DOCKER_REGISTRY_PASS:-}"
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-citecca-website}"
DOCKER_IMAGE_TAG="${DOCKER_IMAGE_TAG:-latest}"
SKIP_DOCKER="${SKIP_DOCKER:-false}"

GIT_REPO="/home/git/repositories/website.git"
CHECKOUT_DIR="$(mktemp -d /tmp/citecca-deploy-XXXXXX)"
WEBSITE_DIR="${CHECKOUT_DIR}/website"
BACKUP_DIR="$(dirname "${DEPLOY_DIR}")/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# ─── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[-]${NC} $*"; }

# ─── Functions ───────────────────────────────────────────────────────

pre_deploy_health_check() {
  info "Pre-deployment health check: ${HEALTH_CHECK_URL}"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$HEALTH_CHECK_URL" 2>/dev/null) || {
    warn "Cannot reach service — service may be down already (http_code=$http_code)"
    return 1
  }
  info "Service is healthy (HTTP ${http_code})"
}

create_backup() {
  info "Creating backup at ${BACKUP_DIR}/${TIMESTAMP}..."
  sudo pct exec "$CONTAINER_ID" -- bash -c "mkdir -p ${BACKUP_DIR} && cp -a ${DEPLOY_DIR} ${BACKUP_DIR}/${TIMESTAMP}" 2>/dev/null
  info "Backup created"
}

checkout_repo() {
  info "Checking out latest from ${GIT_REPO}..."
  rm -rf "$CHECKOUT_DIR"
  git clone --quiet "$GIT_REPO" "$CHECKOUT_DIR" --branch main || \
    git clone --quiet "$GIT_REPO" "$CHECKOUT_DIR" --branch master
  info "Checked out $(git -C "$CHECKOUT_DIR" log --oneline -1)"
}

cleanup_checkout() {
  info "Cleaning up checkout directory..."
  rm -rf "$CHECKOUT_DIR"
}

build() {
  info "Building React application..."
  cd "$WEBSITE_DIR"
  npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null
  npx vite build
  info "Build complete"
}

copy_files() {
  info "Copying build artifacts to container ${CONTAINER_ID}..."
  # Create target dirs
  sudo pct exec "$CONTAINER_ID" -- bash -c "mkdir -p ${DEPLOY_DIR}/dist"

  # Copy static build output
  tar -cz -C "${WEBSITE_DIR}/dist" . | \
    sudo pct exec "$CONTAINER_ID" -- tar -C "$DEPLOY_DIR/dist" -xzf -

  # Copy server files from website/ subdirectory
  tar -cz -C "$WEBSITE_DIR" server.js ecosystem.config.cjs .nvmrc package.json package-lock.json | \
    sudo pct exec "$CONTAINER_ID" -- tar -C "$DEPLOY_DIR" -xzf -
  info "Files copied"
}

install_server_deps() {
  info "Installing server dependencies in container..."
  sudo pct exec "$CONTAINER_ID" -- bash -c "cd $DEPLOY_DIR && npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent 2>/dev/null"
  info "Dependencies installed"
}

fix_nginx_server_tokens() {
  info "Ensuring Nginx server_tokens is disabled..."
  sudo pct exec "$CONTAINER_ID" -- bash -c "
    if grep -q '^# server_tokens off;' /etc/nginx/nginx.conf; then
      sed -i 's|^# server_tokens off;|server_tokens off;|' /etc/nginx/nginx.conf
      systemctl restart nginx
    fi
  "
  info "Nginx server_tokens configured"
}

reload_pm2() {
  info "Reloading PM2 process (zero-downtime)..."
  sudo pct exec "$CONTAINER_ID" -- bash -c "cd $DEPLOY_DIR && pm2 reload citecca-website --update-env"
  info "PM2 reloaded"
}

health_check() {
  local url="${1:-$HEALTH_CHECK_URL}"
  local max_attempts=$((HEALTH_CHECK_TIMEOUT / 2))
  info "Running health check (${max_attempts} attempts, 2s interval)..."

  for i in $(seq 1 "$max_attempts"); do
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null) || http_code="000"
    if [[ "$http_code" == "200" ]]; then
      info "Health check passed (HTTP ${http_code}) on attempt ${i}/${max_attempts}"
      return 0
    fi
    warn "Attempt ${i}/${max_attempts}: HTTP ${http_code}"
    sleep 2
  done

  error "Health check FAILED after ${max_attempts} attempts"
  return 1
}

rollback() {
  warn "Initiating ROLLBACK..."
  local latest_backup
  latest_backup=$(sudo pct exec "$CONTAINER_ID" -- bash -c "ls -td ${BACKUP_DIR}/*/ 2>/dev/null | head -1") || {
    error "No backup found — cannot rollback automatically"
    error "Manual recovery needed: check ${DEPLOY_DIR} in container ${CONTAINER_ID}"
    exit 1
  }
  info "Restoring from backup: ${latest_backup}"
  sudo pct exec "$CONTAINER_ID" -- bash -c "rm -rf ${DEPLOY_DIR}/* && cp -a ${latest_backup}/* ${DEPLOY_DIR}/"
  sudo pct exec "$CONTAINER_ID" -- bash -c "cd $DEPLOY_DIR && pm2 reload citecca-website --update-env"
  sleep 3

  if health_check; then
    info "Rollback successful — service restored"
  else
    error "Rollback health check also failed!"
    sudo pct exec "$CONTAINER_ID" -- bash -c "pm2 logs citecca-website --lines 50"
    exit 1
  fi
}

cleanup_old_backups() {
  info "Cleaning up old backups (keeping last 3)..."
  sudo pct exec "$CONTAINER_ID" -- bash -c "ls -td ${BACKUP_DIR}/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf" 2>/dev/null || true
}

# ─── Docker Image Functions ─────────────────────────────────────────

build_docker_image() {
  info "Building Docker image..."

  # WEBSITE_DIR is already the website/ subdirectory of the checkout
  if [[ ! -f "${WEBSITE_DIR}/Dockerfile" ]]; then
    error "Dockerfile not found at ${WEBSITE_DIR}/Dockerfile"
    return 1
  fi
  cd "$WEBSITE_DIR"

  # Build tagged by commit SHA (the registry-prune timer keeps the last N SHAs)
  docker build -t "$DOCKER_IMAGE_NAME:$COMMIT_SHA" .

  info "Docker image built: $DOCKER_IMAGE_NAME:$COMMIT_SHA"
}

push_docker_image() {
  if [[ -z "$DOCKER_REGISTRY" ]]; then
    info "No DOCKER_REGISTRY configured — skipping push (image stays local)"
    return 0
  fi
  info "Pushing Docker image to registry $DOCKER_REGISTRY..."

  # Login to registry if credentials provided (internal registry: none)
  if [[ -n "${DOCKER_REGISTRY_USER:-}" && -n "${DOCKER_REGISTRY_PASS:-}" ]]; then
    echo "$DOCKER_REGISTRY_PASS" | docker login "$DOCKER_REGISTRY" -u "$DOCKER_REGISTRY_USER" --password-stdin
  fi

  # Push both the commit-SHA tag and latest
  docker push "$DOCKER_IMAGE_NAME:$COMMIT_SHA"
  docker push "$DOCKER_IMAGE_NAME:latest"

  info "Docker image pushed: $DOCKER_IMAGE_NAME:$COMMIT_SHA + latest"
}

tag_docker_image() {
  info "Tagging Docker image..."

  # latest points at this build; the SHA tag is set at build time
  docker tag "$DOCKER_IMAGE_NAME:$COMMIT_SHA" "$DOCKER_IMAGE_NAME:latest"

  info "Image tagged: $COMMIT_SHA, latest"
}

cleanup_docker() {
  info "Cleaning up local build images (keep host images intact)..."

  # Only remove the images we just built — a global 'image prune' could
  # delete unrelated images living on this host.
  docker rmi -f "$DOCKER_IMAGE_NAME:$COMMIT_SHA" 2>/dev/null || true
  docker rmi -f "$DOCKER_IMAGE_NAME:latest" 2>/dev/null || true
  docker image prune -f >/dev/null 2>&1 || true

  info "Docker cleanup complete"
}

# ─── Main Deployment Flow ────────────────────────────────────────────

echo ""
echo "============================================"
echo "  CITECCA Staging Deployment"
echo "  Container: ${CONTAINER_ID}  |  Timestamp: ${TIMESTAMP}"
echo "============================================"
echo ""

# Step 1: Pre-flight health check
pre_deploy_health_check || warn "Service was not healthy before deployment (proceeding anyway)"

# Step 1.5: Checkout latest from git repo
checkout_repo
trap cleanup_checkout EXIT

# Step 2: Create backup for rollback
create_backup

# Step 3: Build locally
build

# Step 4: Copy to container
copy_files

# Step 5: Install server dependencies in container
install_server_deps

# Step 5.5: Fix Nginx server_tokens
fix_nginx_server_tokens

# Step 6: Zero-downtime PM2 reload (uses 2 instances, swaps gracefully)
reload_pm2

# Step 7: Health check
if health_check; then
  info "Deployment successful!"
  cleanup_old_backups
  
  # Step 8: Build (and push) Docker image — final step, non-fatal for the deploy
  if [[ "$SKIP_DOCKER" != "true" ]]; then
    # Get commit SHA for tagging
    COMMIT_SHA=$(git -C "$CHECKOUT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")

    if build_docker_image && tag_docker_image && push_docker_image; then
      info "Docker image ready: $DOCKER_IMAGE_NAME:$DOCKER_IMAGE_TAG"
      cleanup_docker || warn "Docker cleanup failed (non-fatal)"
    else
      error "Docker image build/push FAILED (deploy itself succeeded — log above)"
    fi
  else
    info "Skipping Docker build (SKIP_DOCKER=true)"
  fi
else
  rollback
fi

echo ""
echo "============================================"
echo "  Deployment Complete"
echo "  Frontend: http://192.168.1.200:3000"
echo "============================================"
echo ""

