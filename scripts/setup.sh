#!/bin/bash
# Initial Setup Script for Expo Updates Server (Cloudflare Worker)
#
# This script helps you set up the Cloudflare resources and configure
# the worker for deployment.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_DIR="$ROOT_DIR/worker"

echo "🚀 Expo Updates Server - Cloudflare Worker Setup"
echo "================================================="
echo ""

# Check for wrangler
if ! command -v wrangler &> /dev/null; then
  if ! command -v npx &> /dev/null; then
    echo "❌ Error: wrangler or npx not found. Please install Node.js and run:"
    echo "   npm install -g wrangler"
    exit 1
  fi
  WRANGLER="npx wrangler"
else
  WRANGLER="wrangler"
fi

# Check if logged in
echo "🔑 Checking Cloudflare authentication..."
if ! $WRANGLER whoami &> /dev/null; then
  echo "   Not logged in. Running wrangler login..."
  $WRANGLER login
fi
echo "   ✓ Authenticated"
echo ""

# Create D1 database
echo "📊 Setting up D1 Database..."
read -p "   Database name [expo-updates]: " DB_NAME
DB_NAME="${DB_NAME:-expo-updates}"

if $WRANGLER d1 list 2>/dev/null | grep -q "$DB_NAME"; then
  echo "   ✓ Database '$DB_NAME' already exists"
  DB_ID=$($WRANGLER d1 list 2>/dev/null | grep "$DB_NAME" | awk '{print $1}')
else
  echo "   Creating database '$DB_NAME'..."
  DB_OUTPUT=$($WRANGLER d1 create "$DB_NAME" 2>&1)
  DB_ID=$(echo "$DB_OUTPUT" | grep -oE '[a-f0-9-]{36}' | head -1)
  echo "   ✓ Database created"
fi
echo "   Database ID: $DB_ID"
echo ""

# Create R2 bucket
echo "📦 Setting up R2 Bucket..."
read -p "   Bucket name [expo-updates]: " BUCKET_NAME
BUCKET_NAME="${BUCKET_NAME:-expo-updates}"

if $WRANGLER r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
  echo "   ✓ Bucket '$BUCKET_NAME' already exists"
else
  echo "   Creating bucket '$BUCKET_NAME'..."
  $WRANGLER r2 bucket create "$BUCKET_NAME" 2>&1 || true
  echo "   ✓ Bucket created"
fi
echo ""

# Update wrangler.toml
echo "📝 Updating wrangler.toml..."
cd "$WORKER_DIR"

# Update database ID
sed -i.bak "s/database_id = \"YOUR_DATABASE_ID\"/database_id = \"$DB_ID\"/" wrangler.toml
sed -i.bak "s/database_name = \"expo-updates\"/database_name = \"$DB_NAME\"/" wrangler.toml
sed -i.bak "s/bucket_name = \"expo-updates\"/bucket_name = \"$BUCKET_NAME\"/" wrangler.toml
rm -f wrangler.toml.bak
echo "   ✓ Configuration updated"
echo ""

# Set up secrets
echo "🔐 Setting up secrets..."
echo "   You'll need to set the following secrets:"
echo ""

read -p "   Enter JWT_SECRET (or press Enter to generate): " JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(openssl rand -base64 32)
  echo "   Generated: $JWT_SECRET"
fi
echo "$JWT_SECRET" | $WRANGLER secret put JWT_SECRET
echo "   ✓ JWT_SECRET set"

read -p "   Enter UPLOAD_KEY (or press Enter to generate): " UPLOAD_KEY
if [ -z "$UPLOAD_KEY" ]; then
  UPLOAD_KEY=$(openssl rand -hex 16)
  echo "   Generated: $UPLOAD_KEY"
fi
echo "$UPLOAD_KEY" | $WRANGLER secret put UPLOAD_KEY
echo "   ✓ UPLOAD_KEY set"

read -p "   Enter ADMIN_PASSWORD [admin123]: " ADMIN_PASSWORD
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
echo "$ADMIN_PASSWORD" | $WRANGLER secret put ADMIN_PASSWORD
echo "   ✓ ADMIN_PASSWORD set"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "   ✓ Dependencies installed"
echo ""

# Generate and apply migrations
echo "🗃️  Setting up database schema..."
npm run db:generate 2>/dev/null || echo "   Migrations already exist"
npm run db:migrate
echo "   ✓ Database schema applied"
echo ""

# Build web dashboard
echo "🌐 Building web dashboard..."
cd "$ROOT_DIR"
bash scripts/build-web.sh
echo ""

# Summary
echo "================================================="
echo "✅ Setup Complete!"
echo ""
echo "📋 Configuration Summary:"
echo "   D1 Database:  $DB_NAME ($DB_ID)"
echo "   R2 Bucket:    $BUCKET_NAME"
echo "   Upload Key:   $UPLOAD_KEY"
echo ""
echo "📋 Next Steps:"
echo "   1. Deploy:     cd worker && npm run deploy"
echo "   2. Test:       curl https://your-worker.workers.dev/status"
echo "   3. Login:      username: admin, password: $ADMIN_PASSWORD"
echo ""
echo "📱 Configure your Expo app:"
echo "   updates.url: https://your-worker.workers.dev/api/manifest"
echo ""
echo "📤 Publish updates:"
echo "   ./scripts/expo-publish.sh production ./my-app $UPLOAD_KEY https://your-worker.workers.dev"
