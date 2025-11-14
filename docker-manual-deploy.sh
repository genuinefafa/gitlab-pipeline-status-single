#!/bin/sh
# ============================================================================
# GitLab Pipeline Monitor - Manual Docker Deployment Script
# ============================================================================
# For systems without docker-compose (like LibreELEC)
# Run this script to build and start the GitLab Monitor
# ============================================================================

set -e  # Exit on error

echo "🚀 GitLab Pipeline Monitor - Manual Docker Deployment"
echo "===================================================="

# Configuration
IMAGE_NAME="gitlab-monitor"
IMAGE_TAG="latest"
CONTAINER_NAME="gitlab-monitor"
PORT="3000"
CONFIG_FILE="./config.yaml"
CACHE_VOLUME="gitlab-cache"

# ============================================================================
# Step 1: Check if config exists
# ============================================================================
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Error: config.yaml not found!"
  echo "Please create it from config.example.yaml:"
  echo "  cp config.example.yaml config.yaml"
  echo "  vi config.yaml  # Edit with your GitLab tokens"
  exit 1
fi

echo "✅ Config file found: $CONFIG_FILE"

# ============================================================================
# Step 2: Create volume if it doesn't exist
# ============================================================================
echo ""
echo "📦 Creating volume for cache..."
if docker volume inspect $CACHE_VOLUME >/dev/null 2>&1; then
  echo "✅ Volume '$CACHE_VOLUME' already exists"
else
  docker volume create $CACHE_VOLUME
  echo "✅ Volume '$CACHE_VOLUME' created"
fi

# ============================================================================
# Step 3: Build the Docker image
# ============================================================================
echo ""
echo "🔨 Building Docker image..."
echo "This may take a few minutes on first build..."
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

if [ $? -eq 0 ]; then
  echo "✅ Image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
else
  echo "❌ Build failed!"
  exit 1
fi

# ============================================================================
# Step 4: Stop and remove old container (if exists)
# ============================================================================
echo ""
echo "🧹 Cleaning up old container..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping old container..."
  docker stop $CONTAINER_NAME 2>/dev/null || true
  echo "Removing old container..."
  docker rm $CONTAINER_NAME 2>/dev/null || true
  echo "✅ Old container removed"
else
  echo "✅ No old container to remove"
fi

# ============================================================================
# Step 5: Run the container
# ============================================================================
echo ""
echo "🚀 Starting container..."
docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p ${PORT}:3000 \
  -v "$(pwd)/${CONFIG_FILE}:/app/config.yaml:ro" \
  -v ${CACHE_VOLUME}:/app/.cache \
  -e NODE_ENV=production \
  --health-cmd="wget --quiet --tries=1 --spider http://localhost:3000/about || exit 1" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-start-period=40s \
  --health-retries=3 \
  ${IMAGE_NAME}:${IMAGE_TAG}

if [ $? -eq 0 ]; then
  echo "✅ Container started successfully!"
else
  echo "❌ Failed to start container!"
  exit 1
fi

# ============================================================================
# Step 6: Show status and access info
# ============================================================================
echo ""
echo "===================================================="
echo "✨ Deployment complete!"
echo "===================================================="
echo ""
echo "📊 Container Status:"
docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "🌐 Access:"
echo "  - Local: http://localhost:${PORT}"
echo "  - Network: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo ""
echo "📝 Useful commands:"
echo "  - View logs:      docker logs -f ${CONTAINER_NAME}"
echo "  - Stop:           docker stop ${CONTAINER_NAME}"
echo "  - Start:          docker start ${CONTAINER_NAME}"
echo "  - Restart:        docker restart ${CONTAINER_NAME}"
echo "  - Remove:         docker rm -f ${CONTAINER_NAME}"
echo "  - Rebuild:        docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
echo ""
echo "💡 To view logs now, run:"
echo "  docker logs -f ${CONTAINER_NAME}"
echo ""
