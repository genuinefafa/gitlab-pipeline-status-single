#!/bin/sh
# ============================================================================
# Generate VERSION file with git information
# ============================================================================
# This script creates a VERSION file containing:
# - Git commit hash (short and full)
# - Git branch
# - Build timestamp
# - Git tag (if on a tag)
# ============================================================================

VERSION_FILE="${1:-VERSION}"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "⚠️  Not in a git repository, creating VERSION with 'unknown'"
  cat > "$VERSION_FILE" << EOF
{
  "version": "unknown",
  "commit": "unknown",
  "commitShort": "unknown",
  "branch": "unknown",
  "tag": "",
  "buildDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  exit 0
fi

# Get git information
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_TAG=$(git describe --exact-match --tags 2>/dev/null || echo "")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Determine version string
if [ -n "$GIT_TAG" ]; then
  VERSION="$GIT_TAG"
else
  VERSION="${GIT_BRANCH}-${GIT_COMMIT_SHORT}"
fi

# Create JSON file
cat > "$VERSION_FILE" << EOF
{
  "version": "${VERSION}",
  "commit": "${GIT_COMMIT}",
  "commitShort": "${GIT_COMMIT_SHORT}",
  "branch": "${GIT_BRANCH}",
  "tag": "${GIT_TAG}",
  "buildDate": "${BUILD_DATE}"
}
EOF

echo "✅ Generated $VERSION_FILE:"
cat "$VERSION_FILE"
