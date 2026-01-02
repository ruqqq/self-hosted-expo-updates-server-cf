#!/bin/bash
# Build Web Dashboard for Cloudflare Worker
#
# This script builds the React dashboard and copies it to worker/public
# for serving as static assets.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$ROOT_DIR/Web"
WORKER_DIR="$ROOT_DIR/worker"
PUBLIC_DIR="$WORKER_DIR/public"

echo "🔨 Building Web Dashboard..."
echo "  Source: $WEB_DIR"
echo "  Output: $PUBLIC_DIR"

# Check if Web directory exists
if [ ! -d "$WEB_DIR" ]; then
  echo "❌ Error: Web directory not found at $WEB_DIR"
  exit 1
fi

# Install dependencies if needed
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "📦 Installing Web dependencies..."
  cd "$WEB_DIR"
  yarn install
fi

# Build the web app
echo "🏗️  Building production bundle..."
cd "$WEB_DIR"
yarn run build 2>/dev/null || npx vite build

# Check if build was successful
if [ ! -d "$WEB_DIR/dist" ]; then
  echo "❌ Error: Build failed - dist directory not found"
  exit 1
fi

# Clean previous build
echo "🧹 Cleaning previous build..."
rm -rf "$PUBLIC_DIR"/*
mkdir -p "$PUBLIC_DIR"

# Copy build output
echo "📋 Copying build output..."
cp -r "$WEB_DIR/dist/"* "$PUBLIC_DIR/"

# Remove env-config.js if it exists (we generate it dynamically)
rm -f "$PUBLIC_DIR/env-config.js"

# Count files
FILE_COUNT=$(find "$PUBLIC_DIR" -type f | wc -l)
echo "✅ Build complete! $FILE_COUNT files copied to worker/public"
echo ""
echo "Next steps:"
echo "  1. cd worker"
echo "  2. npm run dev     # Test locally"
echo "  3. npm run deploy  # Deploy to Cloudflare"
