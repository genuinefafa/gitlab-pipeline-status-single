#!/bin/sh
# ============================================================================
# GitLab Pipeline Monitor - Manual Docker Deployment Script
# ============================================================================
# For systems without docker-compose (like LibreELEC)
# Run this script to build and start the GitLab Monitor
#
# Usage:
#   ./docker-manual-deploy.sh [options]
#
# Options:
#   -c, --check        Check config file exists
#   -v, --volume       Create volume
#   -b, --build        Build Docker image
#   -s, --stop         Stop and remove old container
#   -r, --run          Run new container
#   -i, --info         Show status and info
#   -a, --all          Run all steps (default if no options)
#   -h, --help         Show this help
#
# Examples:
#   ./docker-manual-deploy.sh              # Run all steps
#   ./docker-manual-deploy.sh --all        # Run all steps
#   ./docker-manual-deploy.sh -b           # Only build
#   ./docker-manual-deploy.sh -s -r        # Stop old, run new
#   ./docker-manual-deploy.sh -b -s -r     # Build, stop, run
# ============================================================================

set -e  # Exit on error

# Configuration
IMAGE_NAME="gitlab-monitor"
IMAGE_TAG="latest"
CONTAINER_NAME="gitlab-monitor"
PORT="3000"
CONFIG_FILE="./config.yaml"
CACHE_VOLUME="gitlab-cache"

# Flags for what to run
DO_CHECK=0
DO_VOLUME=0
DO_BUILD=0
DO_STOP=0
DO_RUN=0
DO_INFO=0
DO_ALL=0

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
  cat << EOF
GitLab Pipeline Monitor - Manual Docker Deployment Script

Usage:
  $0 [options]

Options:
  -c, --check        Check config file exists
  -v, --volume       Create volume if needed
  -b, --build        Build Docker image
  -s, --stop         Stop and remove old container
  -r, --run          Run new container
  -i, --info         Show status and info
  -a, --all          Run all steps (default)
  -h, --help         Show this help

Examples:
  $0                 # Run all steps (default)
  $0 --all           # Run all steps explicitly
  $0 -b              # Only build image
  $0 -s -r           # Stop old, run new
  $0 -b -s -r -i     # Build, stop, run, show info
  $0 --build --info  # Build and show info

Steps are executed in order: check -> volume -> build -> stop -> run -> info
EOF
  exit 0
}

check_config() {
  echo ""
  echo "🔍 Checking configuration..."
  echo "===================================================="

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: config.yaml not found!"
    echo ""
    echo "Please create it from config.example.yaml:"
    echo "  cp config.example.yaml config.yaml"
    echo "  vi config.yaml  # Edit with your GitLab tokens"
    exit 1
  fi

  echo "✅ Config file found: $CONFIG_FILE"
}

create_volume() {
  echo ""
  echo "📦 Creating volume for cache..."
  echo "===================================================="

  if docker volume inspect $CACHE_VOLUME >/dev/null 2>&1; then
    echo "✅ Volume '$CACHE_VOLUME' already exists"
  else
    docker volume create $CACHE_VOLUME
    echo "✅ Volume '$CACHE_VOLUME' created"
  fi
}

build_image() {
  echo ""
  echo "🔨 Building Docker image..."
  echo "===================================================="

  # Generate version information before build
  echo "📝 Generating version information..."
  if [ -f "./scripts/generate-version.sh" ]; then
    sh ./scripts/generate-version.sh VERSION
  else
    echo "⚠️  Version script not found, using default VERSION file"
  fi

  echo ""
  echo "Building image (may take 5-10 minutes on first build)..."
  echo ""

  docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

  if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
  else
    echo ""
    echo "❌ Build failed!"
    exit 1
  fi
}

stop_old_container() {
  echo ""
  echo "🧹 Cleaning up old container..."
  echo "===================================================="

  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping old container..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    echo "Removing old container..."
    docker rm $CONTAINER_NAME 2>/dev/null || true
    echo "✅ Old container removed"
  else
    echo "✅ No old container to remove"
  fi
}

run_container() {
  echo ""
  echo "🚀 Starting container..."
  echo "===================================================="

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
}

show_info() {
  echo ""
  echo "===================================================="
  echo "✨ Status and Information"
  echo "===================================================="
  echo ""

  echo "📊 Container Status:"
  if docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q "$CONTAINER_NAME"; then
    docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  else
    echo "Container not running"
  fi

  echo ""
  echo "🌐 Access:"
  echo "  - Local: http://localhost:${PORT}"
  if command -v hostname >/dev/null 2>&1; then
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -n "$LOCAL_IP" ]; then
      echo "  - Network: http://${LOCAL_IP}:${PORT}"
    fi
  fi

  echo ""
  echo "📝 Useful commands:"
  echo "  - View logs:      docker logs -f ${CONTAINER_NAME}"
  echo "  - Stop:           docker stop ${CONTAINER_NAME}"
  echo "  - Start:          docker start ${CONTAINER_NAME}"
  echo "  - Restart:        docker restart ${CONTAINER_NAME}"
  echo "  - Remove:         docker rm -f ${CONTAINER_NAME}"
  echo "  - Rebuild:        $0 -b -s -r"
  echo ""
  echo "💡 To view logs now, run:"
  echo "  docker logs -f ${CONTAINER_NAME}"
  echo ""
}

# ============================================================================
# Parse Arguments
# ============================================================================

if [ $# -eq 0 ]; then
  # No arguments = run all
  DO_ALL=1
fi

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    -c|--check)
      DO_CHECK=1
      ;;
    -v|--volume)
      DO_VOLUME=1
      ;;
    -b|--build)
      DO_BUILD=1
      ;;
    -s|--stop)
      DO_STOP=1
      ;;
    -r|--run)
      DO_RUN=1
      ;;
    -i|--info)
      DO_INFO=1
      ;;
    -a|--all)
      DO_ALL=1
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
  shift
done

# ============================================================================
# Execute Selected Steps
# ============================================================================

echo "🚀 GitLab Pipeline Monitor - Manual Docker Deployment"
echo "===================================================="

if [ $DO_ALL -eq 1 ]; then
  DO_CHECK=1
  DO_VOLUME=1
  DO_BUILD=1
  DO_STOP=1
  DO_RUN=1
  DO_INFO=1
fi

# Execute steps in order
[ $DO_CHECK -eq 1 ] && check_config
[ $DO_VOLUME -eq 1 ] && create_volume
[ $DO_BUILD -eq 1 ] && build_image
[ $DO_STOP -eq 1 ] && stop_old_container
[ $DO_RUN -eq 1 ] && run_container
[ $DO_INFO -eq 1 ] && show_info

echo ""
echo "===================================================="
echo "✅ Done!"
echo "===================================================="
