#!/bin/bash
# Build Web Dashboard for Cloudflare Worker
#
# This script copies the dashboard files to worker/public
# for serving as static assets. No build step required!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$ROOT_DIR/worker/dashboard"
PUBLIC_DIR="$ROOT_DIR/worker/public"

echo "📋 Copying Dashboard to worker/public..."
echo "  Source: $DASHBOARD_DIR"
echo "  Output: $PUBLIC_DIR"

# Check if dashboard directory exists
if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "❌ Error: Dashboard directory not found at $DASHBOARD_DIR"
  exit 1
fi

# Clean previous build (but keep .gitkeep if exists)
echo "🧹 Cleaning previous build..."
find "$PUBLIC_DIR" -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true
mkdir -p "$PUBLIC_DIR"

# Copy dashboard files
echo "📋 Copying dashboard files..."
cp -r "$DASHBOARD_DIR/"* "$PUBLIC_DIR/"

# Count files
FILE_COUNT=$(find "$PUBLIC_DIR" -type f | wc -l)
echo "✅ Done! $FILE_COUNT files copied to worker/public"
echo ""
echo "Next steps:"
echo "  1. cd worker"
echo "  2. npm run dev     # Test locally"
echo "  3. npm run deploy  # Deploy to Cloudflare"
