#!/bin/bash
# Publish Expo Update to Self-Hosted Server (Cloudflare Worker)
#
# This script exports your Expo app and uploads it to the updates server.
#
# Usage:
#   ./expo-publish.sh <release-channel> <project-path> <upload-key> <server-url>
#
# Example:
#   ./expo-publish.sh production ./my-app abc123 https://updates.example.com
#
# Required:
#   - expo-cli or eas-cli installed
#   - jq installed (for JSON parsing)

set -e

# Parse arguments
RELEASE_CHANNEL="${1:-staging}"
PROJECT_PATH="${2:-.}"
UPLOAD_KEY="${3}"
SERVER_URL="${4:-http://localhost:3000}"

# Validate arguments
if [ -z "$UPLOAD_KEY" ]; then
  echo "❌ Error: Upload key is required"
  echo ""
  echo "Usage: $0 <release-channel> <project-path> <upload-key> <server-url>"
  echo ""
  echo "Arguments:"
  echo "  release-channel  Release channel name (e.g., staging, production)"
  echo "  project-path     Path to Expo project (default: current directory)"
  echo "  upload-key       Upload authentication key (required)"
  echo "  server-url       Updates server URL (default: http://localhost:3000)"
  exit 1
fi

# Navigate to project
cd "$PROJECT_PATH"

# Check for app.json or app.config.js
if [ ! -f "app.json" ] && [ ! -f "app.config.js" ] && [ ! -f "app.config.ts" ]; then
  echo "❌ Error: No app.json or app.config.js found in $PROJECT_PATH"
  exit 1
fi

# Extract project info from app.json
echo "📱 Reading project configuration..."
if [ -f "app.json" ]; then
  SLUG=$(jq -r '.expo.slug // .slug // empty' app.json)
  RUNTIME_VERSION=$(jq -r '.expo.runtimeVersion // .runtimeVersion // empty' app.json)
  VERSION=$(jq -r '.expo.version // .version // empty' app.json)
else
  # For app.config.js, we need to use Node to evaluate it
  SLUG=$(node -e "const c = require('./app.config.js'); const cfg = typeof c === 'function' ? c({}) : c; console.log(cfg.slug || cfg.expo?.slug || '')")
  RUNTIME_VERSION=$(node -e "const c = require('./app.config.js'); const cfg = typeof c === 'function' ? c({}) : c; console.log(cfg.runtimeVersion || cfg.expo?.runtimeVersion || '')")
  VERSION=$(node -e "const c = require('./app.config.js'); const cfg = typeof c === 'function' ? c({}) : c; console.log(cfg.version || cfg.expo?.version || '')")
fi

# Use version as runtime version if not specified
if [ -z "$RUNTIME_VERSION" ]; then
  RUNTIME_VERSION="$VERSION"
fi

if [ -z "$SLUG" ]; then
  echo "❌ Error: Could not determine project slug from app.json/app.config.js"
  exit 1
fi

if [ -z "$RUNTIME_VERSION" ]; then
  echo "❌ Error: Could not determine runtime version from app.json/app.config.js"
  exit 1
fi

echo "  Project: $SLUG"
echo "  Runtime Version: $RUNTIME_VERSION"
echo "  Release Channel: $RELEASE_CHANNEL"
echo "  Server: $SERVER_URL"
echo ""

# Create temporary directory for export
TEMP_DIR=$(mktemp -d)
BUILD_DIR="$TEMP_DIR/build"

echo "🏗️  Exporting update bundle..."
npx expo export --output-dir "$BUILD_DIR" 2>&1 | tail -5

# Check if export was successful
if [ ! -f "$BUILD_DIR/metadata.json" ]; then
  echo "❌ Error: Export failed - metadata.json not found"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Copy additional files
echo "📋 Adding configuration files..."
cp app.json "$BUILD_DIR/" 2>/dev/null || true
cp app.config.js "$BUILD_DIR/" 2>/dev/null || true
cp package.json "$BUILD_DIR/" 2>/dev/null || true

# Get git info if available
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "📦 Uploading to server..."

# Upload files using multipart form
# We upload each file individually with its path as the form field name
cd "$BUILD_DIR"

# Build the curl command with all files
CURL_ARGS=()
CURL_ARGS+=(-X POST)
CURL_ARGS+=(-H "project: $SLUG")
CURL_ARGS+=(-H "version: $RUNTIME_VERSION")
CURL_ARGS+=(-H "release-channel: $RELEASE_CHANNEL")
CURL_ARGS+=(-H "upload-key: $UPLOAD_KEY")
CURL_ARGS+=(-H "git-branch: $GIT_BRANCH")
CURL_ARGS+=(-H "git-commit: $GIT_COMMIT")

# Add each file to the form
while IFS= read -r -d '' file; do
  # Get relative path
  REL_PATH="${file#./}"
  CURL_ARGS+=(-F "$REL_PATH=@$file")
done < <(find . -type f -print0)

# Execute upload
RESPONSE=$(curl -s -w "\n%{http_code}" "${CURL_ARGS[@]}" "$SERVER_URL/upload")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

# Clean up
rm -rf "$TEMP_DIR"

# Check response
if [ "$HTTP_CODE" = "201" ]; then
  echo ""
  echo "✅ Upload successful!"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  echo ""
  echo "📋 Next steps:"
  echo "   1. Go to your dashboard at $SERVER_URL"
  echo "   2. Find your upload and click 'Release' to make it live"
else
  echo ""
  echo "❌ Upload failed (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi
