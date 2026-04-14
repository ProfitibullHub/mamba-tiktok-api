#!/bin/bash

# Quick Environment Switcher for Mamba TikTok Reporting App
# This script helps you quickly switch between local and production environments

echo "🔄 Mamba Environment Switcher"
echo "=============================="
echo ""
echo "Select environment:"
echo "1) Local Development (localhost)"
echo "2) Production (Vercel)"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
  1)
    echo ""
    echo "📍 Switching to LOCAL DEVELOPMENT..."
    
    # Frontend
    if [ -f ".env.local" ]; then
      cp .env.local .env
      echo "✅ Frontend: Using .env.local"
    else
      echo "⚠️  Frontend: .env.local not found"
    fi
    
    # Backend
    if [ -f "server/.env.local" ]; then
      cp server/.env.local server/.env
      echo "✅ Backend: Using server/.env.local"
    else
      echo "⚠️  Backend: server/.env.local not found"
    fi
    
    echo ""
    echo "✨ Local environment configured!"
    echo "Run: npm run dev (frontend) and cd server && npm run dev (backend)"
    ;;
    
  2)
    echo ""
    echo "🚀 Switching to PRODUCTION..."
    
    # Frontend
    if [ -f ".env.production" ]; then
      cp .env.production .env
      echo "✅ Frontend: Using .env.production"
    else
      echo "⚠️  Frontend: .env.production not found"
    fi
    
    # Backend
    if [ -f "server/.env.production" ]; then
      cp server/.env.production server/.env
      echo "✅ Backend: Using server/.env.production"
    else
      echo "⚠️  Backend: server/.env.production not found"
    fi
    
    echo ""
    echo "✨ Production environment configured!"
    echo "Run: npm run build && npm run preview (frontend)"
    echo "     cd server && npm run build && npm start (backend)"
    ;;
    
  *)
    echo "❌ Invalid choice. Please run again and select 1 or 2."
    exit 1
    ;;
esac

echo ""
