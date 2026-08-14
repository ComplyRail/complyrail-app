#!/bin/bash

# ComplyRail App - Vercel Deployment Helper

echo "🚀 ComplyRail App - Vercel Deployment"
echo ""
echo "This script will help you deploy to Vercel."
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
  echo "📦 Installing Vercel CLI..."
  npm install -g vercel
fi

# Check if logged in
echo "🔐 Checking Vercel login..."
vercel whoami 2>/dev/null || {
  echo "❌ Not logged in to Vercel"
  echo "🔗 Logging in..."
  vercel login
}

echo ""
echo "✅ Ready to deploy!"
echo ""
echo "Choose deployment type:"
echo "1. Preview (creates preview URL)"
echo "2. Production (update live URL)"
echo ""
read -p "Enter choice (1 or 2): " CHOICE

if [ "$CHOICE" = "1" ]; then
  echo ""
  echo "📤 Deploying preview..."
  vercel
elif [ "$CHOICE" = "2" ]; then
  echo ""
  echo "📤 Deploying to production..."
  vercel --prod
else
  echo "❌ Invalid choice"
  exit 1
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 View your deployment at:"
echo "vercel dashboard → Deployments"
