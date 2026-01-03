#!/bin/bash

# Self-Hosted Expo Updates - Publish Script
# Uploads an Expo update to the Cloudflare Worker server
#
# Can read from .env file or command line arguments

set -e

# Load .env if exists
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

# Command line args override .env
RELEASECHANNEL=${1:-$EXPO_RELEASE_CHANNEL}
PROJECTPATH=${2:-.}
UPLOADKEY=${3:-$EXPO_UPLOAD_KEY}
APISERVER=${4:-$EXPO_API_SERVER}

showUsage() {
  echo "Usage: expo-publish-selfhosted.sh [release-channel] [project-folder] [upload-key] [api-server]"
  echo ""
  echo "Arguments can be provided via command line or .env file."
  echo ""
  echo "Command line example:"
  echo "  ./expo-publish-selfhosted.sh production ./my-app abc123 https://updates.example.com"
  echo ""
  echo ".env file example:"
  echo "  EXPO_RELEASE_CHANNEL=production"
  echo "  EXPO_UPLOAD_KEY=your-upload-key"
  echo "  EXPO_API_SERVER=https://updates.example.com"
  echo ""
  echo "Then run: ./expo-publish-selfhosted.sh"
}

# Check required parameters
if [ -z "$RELEASECHANNEL" ]; then
  echo "Error: missing release channel."
  echo "Set EXPO_RELEASE_CHANNEL in .env or pass as first argument."
  echo ""
  showUsage
  exit 1
fi

if [ -z "$UPLOADKEY" ]; then
  echo "Error: missing upload key."
  echo "Set EXPO_UPLOAD_KEY in .env or pass as third argument."
  echo ""
  showUsage
  exit 1
fi

if [ -z "$APISERVER" ]; then
  echo "Error: missing API server."
  echo "Set EXPO_API_SERVER in .env or pass as fourth argument."
  echo ""
  showUsage
  exit 1
fi

# Navigate to project
cd "$PROJECTPATH"
if [ ! -f "app.json" ]; then
  echo "Error: app.json not found in $(pwd)"
  exit 1
fi

# Get project info from app.json
SLUG=$(grep -o '"slug": "[^"]*' app.json | grep -o '[^"]*$' || true)

# Runtime version priority: env var > expo config > runtimeVersion string > version
if [ -n "$EXPO_RUNTIME_VERSION" ]; then
  RUNTIMEVERSION="$EXPO_RUNTIME_VERSION"
else
  # Try to get resolved runtimeVersion from expo config (handles policies like fingerprint)
  echo "Resolving runtime version..."
  RUNTIMEVERSION=$(npx expo config --json 2>/dev/null | grep -o '"runtimeVersion": "[^"]*' | grep -o '[^"]*$' || true)

  # Fallback: try to get runtimeVersion as string from app.json
  if [ -z "$RUNTIMEVERSION" ]; then
    RUNTIMEVERSION=$(grep -o '"runtimeVersion": "[^"]*' app.json | grep -o '[^"]*$' || true)
  fi

  # Fallback: try version field
  if [ -z "$RUNTIMEVERSION" ]; then
    RUNTIMEVERSION=$(grep -o '"version": "[^"]*' app.json | grep -o '[^"]*$' | head -1 || true)
  fi
fi

if [ -z "$SLUG" ]; then
  echo "Error: Could not find 'slug' in app.json"
  exit 1
fi

if [ -z "$RUNTIMEVERSION" ]; then
  echo "Error: Could not determine runtimeVersion"
  echo ""
  echo "Options:"
  echo "  1. Set EXPO_RUNTIME_VERSION in your .env file"
  echo "  2. Use a string runtimeVersion in app.json: \"runtimeVersion\": \"1.0.0\""
  exit 1
fi

echo "Publishing update..."
echo "  Project: $SLUG"
echo "  Version: $RUNTIMEVERSION"
echo "  Channel: $RELEASECHANNEL"
echo "  Server:  $APISERVER"
echo ""

# Create temp build folder
BUILDFOLDER="/tmp/expo-publish-$SLUG-$$"
rm -rf "$BUILDFOLDER"
mkdir -p "$BUILDFOLDER"

# Export the update
echo "Running expo export..."
npx expo export --output-dir "$BUILDFOLDER"

# Copy app.json for metadata
cp app.json "$BUILDFOLDER/"

# Get version control info (supports both jj and git)
VCS_BRANCH=""
VCS_COMMIT=""

if [ -d ".jj" ]; then
  # Jujutsu (jj) repository
  VCS_BRANCH=$(jj log -r @ --no-graph -T 'bookmarks' 2>/dev/null | head -1 || echo "")
  VCS_COMMIT=$(jj log -r @ --no-graph -T 'commit_id.short()' 2>/dev/null || echo "")
  # If no bookmark, try to get description as context
  if [ -z "$VCS_BRANCH" ]; then
    VCS_BRANCH=$(jj log -r @ --no-graph -T 'description.first_line()' 2>/dev/null | head -c 50 || echo "")
  fi
elif [ -d ".git" ]; then
  # Git repository
  VCS_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  VCS_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
fi

# Build curl arguments
echo ""
echo "Uploading to server..."

CURL_ARGS=(
  -s -X POST "$APISERVER/upload"
  -H "upload-key: $UPLOADKEY"
  -H "project: $SLUG"
  -H "version: $RUNTIMEVERSION"
  -H "release-channel: $RELEASECHANNEL"
)

if [ -n "$VCS_BRANCH" ]; then
  CURL_ARGS+=(-H "git-branch: $VCS_BRANCH")
fi

if [ -n "$VCS_COMMIT" ]; then
  CURL_ARGS+=(-H "git-commit: $VCS_COMMIT")
fi

# Add metadata.json if exists
if [ -f "$BUILDFOLDER/metadata.json" ]; then
  CURL_ARGS+=(-F "metadata.json=@$BUILDFOLDER/metadata.json")
fi

# Add app.json
CURL_ARGS+=(-F "app.json=@$BUILDFOLDER/app.json")

# Add bundles
if [ -d "$BUILDFOLDER/bundles" ]; then
  for file in "$BUILDFOLDER/bundles"/*; do
    if [ -f "$file" ]; then
      filename=$(basename "$file")
      CURL_ARGS+=(-F "bundles/$filename=@$file")
    fi
  done
fi

# Add assets
if [ -d "$BUILDFOLDER/assets" ]; then
  for file in "$BUILDFOLDER/assets"/*; do
    if [ -f "$file" ]; then
      filename=$(basename "$file")
      CURL_ARGS+=(-F "assets/$filename=@$file")
    fi
  done
fi

# Execute upload
curl "${CURL_ARGS[@]}"
echo ""

# Cleanup
rm -rf "$BUILDFOLDER"

echo ""
echo "Upload complete!"
echo ""
echo "Next steps:"
echo "  1. Go to your dashboard: $APISERVER"
echo "  2. Find your app: $SLUG"
echo "  3. Release the update to make it available to users"
