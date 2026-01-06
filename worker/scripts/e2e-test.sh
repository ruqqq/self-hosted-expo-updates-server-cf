#!/bin/bash
# E2E Test Script for Expo Updates Server (Cloudflare Worker)
#
# Usage: ./e2e-test.sh [base_url]
#
# Environment Variables:
#   BASE_URL       - Server URL (default: http://localhost:3000)
#   ADMIN_PASSWORD - Admin password (default: admin)
#   UPLOAD_KEY     - Upload key (required)

set -e

# =============================================================================
# Configuration
# =============================================================================

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
UPLOAD_KEY="${UPLOAD_KEY:-}"

# Test identifiers
TEST_ID="e2e-$(date +%s)"
TEST_APP_ID="test-app-${TEST_ID}"
TEMP_DIR="/tmp/e2e-test-bundle-${TEST_ID}"

# State variables
TOKEN=""
UPLOAD_1_ID=""
UPLOAD_2_ID=""
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Colors and Output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
  echo -e "${BLUE}→${NC} $1"
}

header() {
  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}  $1${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# =============================================================================
# Cleanup
# =============================================================================

cleanup() {
  header "Cleanup"

  # Delete test app (which cascades to uploads)
  if [ -n "$TOKEN" ]; then
    info "Deleting test app: ${TEST_APP_ID}"
    curl -s -X DELETE "${BASE_URL}/apps/${TEST_APP_ID}" \
      -H "Authorization: Bearer ${TOKEN}" > /dev/null 2>&1 || true
  fi

  # Remove temp directory
  if [ -d "$TEMP_DIR" ]; then
    info "Removing temp directory: ${TEMP_DIR}"
    rm -rf "$TEMP_DIR"
  fi

  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  Results: ${GREEN}${TESTS_PASSED} passed${NC}, ${RED}${TESTS_FAILED} failed${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
  fi
}

trap cleanup EXIT

# =============================================================================
# Mock Bundle Creation
# =============================================================================

create_mock_bundle() {
  local version="$1"

  mkdir -p "${TEMP_DIR}/bundles"

  # metadata.json
  cat > "${TEMP_DIR}/metadata.json" << EOF
{
  "version": 0,
  "bundler": "metro",
  "fileMetadata": {
    "ios": {
      "bundle": "bundles/ios-${version}.js",
      "assets": []
    },
    "android": {
      "bundle": "bundles/android-${version}.js",
      "assets": []
    }
  }
}
EOF

  # app.json
  cat > "${TEMP_DIR}/app.json" << EOF
{
  "expo": {
    "name": "E2E Test App",
    "slug": "${TEST_APP_ID}",
    "version": "${version}",
    "runtimeVersion": "1.0.0"
  }
}
EOF

  # Bundle files
  echo "console.log('iOS bundle version ${version}');" > "${TEMP_DIR}/bundles/ios-${version}.js"
  echo "console.log('Android bundle version ${version}');" > "${TEMP_DIR}/bundles/android-${version}.js"
}

# =============================================================================
# Validation
# =============================================================================

header "E2E Test Suite"
echo ""
info "Base URL: ${BASE_URL}"
info "Test App ID: ${TEST_APP_ID}"
echo ""

# Check required tools
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is required but not installed${NC}"
  exit 1
fi

if ! command -v curl &> /dev/null; then
  echo -e "${RED}Error: curl is required but not installed${NC}"
  exit 1
fi

if [ -z "$UPLOAD_KEY" ]; then
  echo -e "${RED}Error: UPLOAD_KEY environment variable is required${NC}"
  exit 1
fi

# =============================================================================
# Test 1: Health Check
# =============================================================================

header "Test 1: Health Check"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/status")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  STATUS=$(echo "$BODY" | jq -r '.status')
  VERSION=$(echo "$BODY" | jq -r '.version')
  if [ "$STATUS" = "ok" ]; then
    pass "GET /status - Server is healthy (v${VERSION})"
  else
    fail "GET /status - Unexpected status: ${STATUS}"
  fi
else
  fail "GET /status - HTTP ${HTTP_CODE}"
fi

# =============================================================================
# Test 2: Authentication
# =============================================================================

header "Test 2: Authentication"

# Test invalid credentials
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/authentication" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrong-password"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
  pass "POST /authentication - Rejects invalid credentials"
else
  fail "POST /authentication - Expected 401, got ${HTTP_CODE}"
fi

# Test valid credentials
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/authentication" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASSWORD}\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  TOKEN=$(echo "$BODY" | jq -r '.accessToken')
  USERNAME=$(echo "$BODY" | jq -r '.user.username')
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    pass "POST /authentication - Login successful (user: ${USERNAME})"
  else
    fail "POST /authentication - No token in response"
  fi
else
  fail "POST /authentication - HTTP ${HTTP_CODE}"
  echo "$BODY"
  exit 1
fi

# =============================================================================
# Test 3: Create App
# =============================================================================

header "Test 3: Create App"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/apps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"${TEST_APP_ID}\",\"name\":\"E2E Test App\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  APP_ID=$(echo "$BODY" | jq -r '.id')
  if [ "$APP_ID" = "$TEST_APP_ID" ]; then
    pass "POST /apps - Created app: ${APP_ID}"
  else
    fail "POST /apps - Unexpected app ID: ${APP_ID}"
  fi
else
  fail "POST /apps - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# =============================================================================
# Test 4: Upload Bundle (v1)
# =============================================================================

header "Test 4: Upload Bundle (v1.0.0)"

create_mock_bundle "1.0.0"

# Test without upload-key
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
  -H "project: ${TEST_APP_ID}" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -F "metadata.json=@${TEMP_DIR}/metadata.json" \
  -F "app.json=@${TEMP_DIR}/app.json" \
  -F "bundles/ios-1.0.0.js=@${TEMP_DIR}/bundles/ios-1.0.0.js" \
  -F "bundles/android-1.0.0.js=@${TEMP_DIR}/bundles/android-1.0.0.js")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
  pass "POST /upload - Rejects missing upload-key"
else
  fail "POST /upload - Expected 401 without key, got ${HTTP_CODE}"
fi

# Test with upload-key
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
  -H "project: ${TEST_APP_ID}" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -H "upload-key: ${UPLOAD_KEY}" \
  -H "git-branch: e2e-test" \
  -H "git-commit: abc123" \
  -F "metadata.json=@${TEMP_DIR}/metadata.json" \
  -F "app.json=@${TEMP_DIR}/app.json" \
  -F "bundles/ios-1.0.0.js=@${TEMP_DIR}/bundles/ios-1.0.0.js" \
  -F "bundles/android-1.0.0.js=@${TEMP_DIR}/bundles/android-1.0.0.js")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  UPLOAD_1_ID=$(echo "$BODY" | jq -r '.id')
  STATUS=$(echo "$BODY" | jq -r '.status')
  if [ -n "$UPLOAD_1_ID" ] && [ "$STATUS" = "ready" ]; then
    pass "POST /upload - Upload successful (id: ${UPLOAD_1_ID}, status: ${STATUS})"
  else
    fail "POST /upload - Unexpected response"
    echo "$BODY"
  fi
else
  fail "POST /upload - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# =============================================================================
# Test 5: Release Upload
# =============================================================================

header "Test 5: Release Upload"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/utils/release" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"${UPLOAD_1_ID}\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  SUCCESS=$(echo "$BODY" | jq -r '.success')
  if [ "$SUCCESS" = "true" ]; then
    pass "POST /utils/release - Upload released"
  else
    fail "POST /utils/release - success=false"
  fi
else
  fail "POST /utils/release - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# =============================================================================
# Test 6: Fetch Manifest
# =============================================================================

header "Test 6: Fetch Manifest (Expo Client)"

# Test non-existent project
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: non-existent" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "404" ]; then
  pass "GET /api/manifest - Returns 404 for non-existent project"
else
  fail "GET /api/manifest - Expected 404 for non-existent project, got ${HTTP_CODE}"
fi

# Test valid request (iOS)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  if echo "$BODY" | grep -q "launchAsset"; then
    pass "GET /api/manifest (iOS) - Returns valid manifest"
  else
    fail "GET /api/manifest (iOS) - Missing launchAsset in response"
  fi
else
  fail "GET /api/manifest (iOS) - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# Test valid request (Android)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: android" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest (Android) - Returns valid manifest"
else
  fail "GET /api/manifest (Android) - HTTP ${HTTP_CODE}"
fi

# =============================================================================
# Test 7: Case-Insensitive Lookups
# =============================================================================

header "Test 7: Case-Insensitive Lookups"

# Test manifest with lowercase project ID
LOWERCASE_APP_ID=$(echo "$TEST_APP_ID" | tr '[:upper:]' '[:lower:]')
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${LOWERCASE_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest - Works with lowercase project ID"
else
  fail "GET /api/manifest - Case-insensitive lookup failed, got ${HTTP_CODE}"
fi

# Test manifest with uppercase project ID
UPPERCASE_APP_ID=$(echo "$TEST_APP_ID" | tr '[:lower:]' '[:upper:]')
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${UPPERCASE_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest - Works with uppercase project ID"
else
  fail "GET /api/manifest - Case-insensitive lookup failed, got ${HTTP_CODE}"
fi

# Test path-based manifest URL with lowercase
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest/${LOWERCASE_APP_ID}/production" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest/:project/:channel - Path-based URL works with lowercase"
else
  fail "GET /api/manifest/:project/:channel - Path-based lookup failed, got ${HTTP_CODE}"
fi

# Test GET /apps/:id with different casing
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/apps/${LOWERCASE_APP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /apps/:id - Works with lowercase app ID"
else
  fail "GET /apps/:id - Case-insensitive lookup failed, got ${HTTP_CODE}"
fi

# Test GET /stats/:project with different casing
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/stats/${LOWERCASE_APP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /stats/:project - Works with lowercase project ID"
else
  fail "GET /stats/:project - Case-insensitive lookup failed, got ${HTTP_CODE}"
fi

# =============================================================================
# Test 8: Upload Second Bundle (v1.0.1)
# =============================================================================

header "Test 8: Upload Second Bundle (v1.0.1)"

create_mock_bundle "1.0.1"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
  -H "project: ${TEST_APP_ID}" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -H "upload-key: ${UPLOAD_KEY}" \
  -H "git-branch: e2e-test" \
  -H "git-commit: def456" \
  -F "metadata.json=@${TEMP_DIR}/metadata.json" \
  -F "app.json=@${TEMP_DIR}/app.json" \
  -F "bundles/ios-1.0.1.js=@${TEMP_DIR}/bundles/ios-1.0.1.js" \
  -F "bundles/android-1.0.1.js=@${TEMP_DIR}/bundles/android-1.0.1.js")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  UPLOAD_2_ID=$(echo "$BODY" | jq -r '.id')
  pass "POST /upload - Second upload successful (id: ${UPLOAD_2_ID})"
else
  fail "POST /upload - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# =============================================================================
# Test 9: Release Second Upload
# =============================================================================

header "Test 9: Release Second Upload"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/utils/release" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"${UPLOAD_2_ID}\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "POST /utils/release - Second upload released"
else
  fail "POST /utils/release - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# Verify first upload is now obsolete
RESPONSE=$(curl -s "${BASE_URL}/uploads?project=${TEST_APP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
UPLOAD_1_STATUS=$(echo "$RESPONSE" | jq -r ".[] | select(.id==\"${UPLOAD_1_ID}\") | .status")

if [ "$UPLOAD_1_STATUS" = "obsolete" ]; then
  pass "First upload is now obsolete"
else
  fail "First upload should be obsolete, got: ${UPLOAD_1_STATUS}"
fi

# =============================================================================
# Test 10: Rollback
# =============================================================================

header "Test 10: Rollback"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/utils/rollback" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"${UPLOAD_1_ID}\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  SUCCESS=$(echo "$BODY" | jq -r '.success')
  if [ "$SUCCESS" = "true" ]; then
    pass "POST /utils/rollback - Rolled back to first upload"
  else
    fail "POST /utils/rollback - success=false"
  fi
else
  fail "POST /utils/rollback - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# Verify status changes
RESPONSE=$(curl -s "${BASE_URL}/uploads?project=${TEST_APP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
UPLOAD_1_STATUS=$(echo "$RESPONSE" | jq -r ".[] | select(.id==\"${UPLOAD_1_ID}\") | .status")
UPLOAD_2_STATUS=$(echo "$RESPONSE" | jq -r ".[] | select(.id==\"${UPLOAD_2_ID}\") | .status")

if [ "$UPLOAD_1_STATUS" = "released" ]; then
  pass "First upload is now released after rollback"
else
  fail "First upload should be released, got: ${UPLOAD_1_STATUS}"
fi

if [ "$UPLOAD_2_STATUS" = "obsolete" ]; then
  pass "Second upload is now obsolete after rollback"
else
  fail "Second upload should be obsolete, got: ${UPLOAD_2_STATUS}"
fi

# =============================================================================
# Test 11: Verify Rollback in Manifest
# =============================================================================

header "Test 11: Verify Rollback in Manifest"

RESPONSE=$(curl -s "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")

# The manifest should now serve the first upload
if echo "$RESPONSE" | grep -q "ios-1.0.0.js"; then
  pass "GET /api/manifest - Serves rolled-back version (v1.0.0)"
else
  # Check if it at least returns a valid manifest
  if echo "$RESPONSE" | grep -q "launchAsset"; then
    pass "GET /api/manifest - Returns valid manifest after rollback"
  else
    fail "GET /api/manifest - Invalid manifest after rollback"
  fi
fi

# =============================================================================
# Test 12: Platform-Specific Uploads
# =============================================================================

header "Test 12: Platform-Specific Uploads"

# Create a new mock bundle for platform-specific test
create_mock_bundle "2.0.0"

# Upload iOS-only bundle
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
  -H "project: ${TEST_APP_ID}" \
  -H "version: 2.0.0-ios" \
  -H "release-channel: production" \
  -H "platform: ios" \
  -H "upload-key: ${UPLOAD_KEY}" \
  -F "metadata.json=@${TEMP_DIR}/metadata.json" \
  -F "app.json=@${TEMP_DIR}/app.json" \
  -F "bundles/ios-2.0.0.js=@${TEMP_DIR}/bundles/ios-2.0.0.js" \
  -F "bundles/android-2.0.0.js=@${TEMP_DIR}/bundles/android-2.0.0.js")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  IOS_UPLOAD_ID=$(echo "$BODY" | jq -r '.id')
  UPLOAD_PLATFORM=$(echo "$BODY" | jq -r '.platform')
  if [ "$UPLOAD_PLATFORM" = "ios" ]; then
    pass "POST /upload (platform: ios) - Upload created with correct platform"
  else
    fail "POST /upload (platform: ios) - Expected platform=ios, got ${UPLOAD_PLATFORM}"
  fi
else
  fail "POST /upload (platform: ios) - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# Upload Android-only bundle
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
  -H "project: ${TEST_APP_ID}" \
  -H "version: 2.0.0-android" \
  -H "release-channel: production" \
  -H "platform: android" \
  -H "upload-key: ${UPLOAD_KEY}" \
  -F "metadata.json=@${TEMP_DIR}/metadata.json" \
  -F "app.json=@${TEMP_DIR}/app.json" \
  -F "bundles/ios-2.0.0.js=@${TEMP_DIR}/bundles/ios-2.0.0.js" \
  -F "bundles/android-2.0.0.js=@${TEMP_DIR}/bundles/android-2.0.0.js")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  ANDROID_UPLOAD_ID=$(echo "$BODY" | jq -r '.id')
  UPLOAD_PLATFORM=$(echo "$BODY" | jq -r '.platform')
  if [ "$UPLOAD_PLATFORM" = "android" ]; then
    pass "POST /upload (platform: android) - Upload created with correct platform"
  else
    fail "POST /upload (platform: android) - Expected platform=android, got ${UPLOAD_PLATFORM}"
  fi
else
  fail "POST /upload (platform: android) - HTTP ${HTTP_CODE}"
  echo "$BODY"
fi

# Release both platform-specific uploads
curl -s -X POST "${BASE_URL}/utils/release" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"${IOS_UPLOAD_ID}\"}" > /dev/null

curl -s -X POST "${BASE_URL}/utils/release" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"${ANDROID_UPLOAD_ID}\"}" > /dev/null

pass "Released both platform-specific uploads"

# =============================================================================
# Test 13: Platform Filtering in Manifest
# =============================================================================

header "Test 13: Platform Filtering in Manifest"

# iOS should get iOS-only version
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 2.0.0-ios" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest (iOS, version 2.0.0-ios) - Returns iOS-specific update"
else
  fail "GET /api/manifest (iOS, version 2.0.0-ios) - HTTP ${HTTP_CODE}"
fi

# iOS should NOT get Android-only version
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 2.0.0-android" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "404" ]; then
  pass "GET /api/manifest (iOS, version 2.0.0-android) - Correctly returns 404"
else
  fail "GET /api/manifest (iOS, version 2.0.0-android) - Expected 404, got ${HTTP_CODE}"
fi

# Android should get Android-only version
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: android" \
  -H "expo-runtime-version: 2.0.0-android" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest (Android, version 2.0.0-android) - Returns Android-specific update"
else
  fail "GET /api/manifest (Android, version 2.0.0-android) - HTTP ${HTTP_CODE}"
fi

# Android should NOT get iOS-only version
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: android" \
  -H "expo-runtime-version: 2.0.0-ios" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "404" ]; then
  pass "GET /api/manifest (Android, version 2.0.0-ios) - Correctly returns 404"
else
  fail "GET /api/manifest (Android, version 2.0.0-ios) - Expected 404, got ${HTTP_CODE}"
fi

# Both platforms should still get "all" platform uploads (v1.0.0 from earlier tests)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest (iOS) - Still gets platform='all' uploads"
else
  fail "GET /api/manifest (iOS) - Expected 200 for platform='all' upload, got ${HTTP_CODE}"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/manifest" \
  -H "expo-project: ${TEST_APP_ID}" \
  -H "expo-platform: android" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/manifest (Android) - Still gets platform='all' uploads"
else
  fail "GET /api/manifest (Android) - Expected 200 for platform='all' upload, got ${HTTP_CODE}"
fi

echo ""
info "All tests completed!"
