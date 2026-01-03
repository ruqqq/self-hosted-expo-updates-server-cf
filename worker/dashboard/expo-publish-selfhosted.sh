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

if [ -z "$SLUG" ]; then
  echo "Error: Could not find 'slug' in app.json"
  exit 1
fi

echo "Publishing update..."
echo "  Project: $SLUG"
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

# Runtime version priority: env var > policy-based > string > version fallback
if [ -n "$EXPO_RUNTIME_VERSION" ]; then
  RUNTIMEVERSION="$EXPO_RUNTIME_VERSION"
  echo "Using runtime version from EXPO_RUNTIME_VERSION: $RUNTIMEVERSION"
else
  # Check if runtimeVersion is a policy object
  IS_POLICY=$(grep -o '"runtimeVersion"[[:space:]]*:[[:space:]]*{' app.json || true)

  if [ -n "$IS_POLICY" ]; then
    # Detect which policy is being used
    IS_APPVERSION=$(grep -o '"policy"[[:space:]]*:[[:space:]]*"appVersion"' app.json || true)
    IS_FINGERPRINT=$(grep -o '"policy"[[:space:]]*:[[:space:]]*"fingerprint"' app.json || true)
    IS_NATIVEVERSION=$(grep -o '"policy"[[:space:]]*:[[:space:]]*"nativeVersion"' app.json || true)
    IS_SDKVERSION=$(grep -o '"policy"[[:space:]]*:[[:space:]]*"sdkVersion"' app.json || true)

    if [ -n "$IS_APPVERSION" ]; then
      # appVersion policy: use the "version" field from app.json
      # Check for platform-specific versions (expo.ios.version, expo.android.version)
      echo "Detected runtimeVersion policy: appVersion"

      if command -v jq &> /dev/null; then
        # Use jq for reliable JSON parsing
        BASE_VERSION=$(jq -r '.expo.version // .version // empty' app.json 2>/dev/null || true)
        IOS_VERSION=$(jq -r '.expo.ios.version // .expo.version // .version // empty' app.json 2>/dev/null || true)
        ANDROID_VERSION=$(jq -r '.expo.android.version // .expo.version // .version // empty' app.json 2>/dev/null || true)
      else
        # Fallback to grep (less reliable for nested objects)
        BASE_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*' app.json | head -1 | grep -o '"[^"]*$' | tr -d '"' || true)
        IOS_VERSION="$BASE_VERSION"
        ANDROID_VERSION="$BASE_VERSION"
      fi

      if [ "$IOS_VERSION" != "$ANDROID_VERSION" ]; then
        echo "Platform-specific versions detected:"
        echo "  iOS:     $IOS_VERSION"
        echo "  Android: $ANDROID_VERSION"
        PLATFORM_SPECIFIC_VERSIONS="true"
      else
        RUNTIMEVERSION="$IOS_VERSION"
        echo "Using app version: $RUNTIMEVERSION"
      fi

    elif [ -n "$IS_NATIVEVERSION" ]; then
      # nativeVersion policy: use version + buildNumber/versionCode
      echo "Detected runtimeVersion policy: nativeVersion"
      APP_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*' app.json | head -1 | grep -o '"[^"]*$' | tr -d '"' || true)
      # For simplicity, just use the version - full nativeVersion would need ios.buildNumber/android.versionCode
      RUNTIMEVERSION="$APP_VERSION"
      echo "Using native version: $RUNTIMEVERSION"
      echo "Warning: nativeVersion policy may need buildNumber/versionCode appended"

    elif [ -n "$IS_SDKVERSION" ]; then
      # sdkVersion policy: use expo SDK version
      echo "Detected runtimeVersion policy: sdkVersion"
      RUNTIMEVERSION=$(grep -o '"sdkVersion"[[:space:]]*:[[:space:]]*"[^"]*' app.json | grep -o '"[^"]*$' | tr -d '"' || true)
      echo "Using SDK version: $RUNTIMEVERSION"

    elif [ -n "$IS_FINGERPRINT" ]; then
      # fingerprint policy: compute hash
      echo "Detected runtimeVersion policy: fingerprint"
      echo "Computing fingerprint hash..."
      if command -v jq &> /dev/null; then
        RUNTIMEVERSION=$(npx @expo/fingerprint . 2>/dev/null | jq -r '.hash' 2>/dev/null || true)
      else
        RUNTIMEVERSION=$(npx @expo/fingerprint . 2>/dev/null | grep -o '"hash":"[^"]*' | grep -o '[^"]*$' || true)
      fi

      if [ -n "$RUNTIMEVERSION" ]; then
        echo "Computed fingerprint: $RUNTIMEVERSION"
      else
        echo "Warning: Could not compute fingerprint. Set EXPO_RUNTIME_VERSION manually."
      fi
    fi
  fi

  # Fallback: try runtimeVersion as string from app.json
  if [ -z "$RUNTIMEVERSION" ]; then
    RUNTIMEVERSION=$(grep -o '"runtimeVersion"[[:space:]]*:[[:space:]]*"[^"]*' app.json | grep -o '"[^"]*$' | tr -d '"' || true)
  fi

  # Fallback: try version field
  if [ -z "$RUNTIMEVERSION" ]; then
    RUNTIMEVERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*' app.json | head -1 | grep -o '"[^"]*$' | tr -d '"' || true)
  fi
fi

if [ -z "$RUNTIMEVERSION" ] && [ -z "$PLATFORM_SPECIFIC_VERSIONS" ]; then
  echo "Error: Could not determine runtimeVersion"
  echo ""
  echo "Options:"
  echo "  1. Set EXPO_RUNTIME_VERSION in your .env file"
  echo "  2. Use a string runtimeVersion in app.json: \"runtimeVersion\": \"1.0.0\""
  exit 1
fi

if [ -n "$RUNTIMEVERSION" ]; then
  echo "  Version: $RUNTIMEVERSION"
fi

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

# Upload function
# Usage: do_upload <version> [platform]
do_upload() {
  local upload_version="$1"
  local upload_platform="${2:-}"

  echo ""
  if [ -n "$upload_platform" ]; then
    echo "Uploading for $upload_platform (version: $upload_version)..."
  else
    echo "Uploading to server (version: $upload_version)..."
  fi

  local CURL_ARGS=(
    -s -X POST "$APISERVER/upload"
    -H "upload-key: $UPLOADKEY"
    -H "project: $SLUG"
    -H "version: $upload_version"
    -H "release-channel: $RELEASECHANNEL"
  )

  if [ -n "$upload_platform" ]; then
    CURL_ARGS+=(-H "platform: $upload_platform")
  fi

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

  # Add bundles from _expo/static/js directory (expo export output)
  # Preserves the path structure that metadata.json references
  if [ -d "$BUILDFOLDER/_expo/static/js" ]; then
    while IFS= read -r -d '' file; do
      # Get relative path from BUILDFOLDER (e.g., _expo/static/js/ios/index-xxx.hbc)
      relpath="${file#$BUILDFOLDER/}"
      CURL_ARGS+=(-F "$relpath=@$file")
    done < <(find "$BUILDFOLDER/_expo/static/js" -type f -print0)
  fi

  # Add assets (hash-named files)
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
}

# Perform upload(s)
if [ -n "$PLATFORM_SPECIFIC_VERSIONS" ]; then
  # Different versions for iOS and Android - upload separately
  echo ""
  echo "Uploading platform-specific updates..."

  do_upload "$IOS_VERSION" "ios"
  do_upload "$ANDROID_VERSION" "android"
else
  # Same version for both platforms - single upload
  do_upload "$RUNTIMEVERSION"
fi

# Cleanup
rm -rf "$BUILDFOLDER"

echo ""
echo "Upload complete!"
echo ""
echo "Next steps:"
echo "  1. Go to your dashboard: $APISERVER"
echo "  2. Find your app: $SLUG"
echo "  3. Release the update to make it available to users"
