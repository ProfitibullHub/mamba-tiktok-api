# 🚀 Deployment Setup Guide

This guide will help you deploy your Mamba TikTok Reporting App to GitHub and Vercel, and easily switch between local and production environments.

## 📋 Table of Contents

1. [Environment Configuration](#environment-configuration)
2. [Local Development](#local-development)
3. [GitHub Setup](#github-setup)
4. [Vercel Deployment](#vercel-deployment)
5. [Switching Between Environments](#switching-between-environments)

---

## 🔧 Environment Configuration

Your project now has separate environment files for local and production:

### Frontend Environment Files

- **`.env.local`** - Used for local development (localhost)
- **`.env.production`** - Used for Vercel deployment (production URLs)

### Backend Environment Files

- **`server/.env.local`** - Used for local development (localhost)
- **`server/.env.production`** - Used for Vercel deployment (production URLs)

> **Note:** These files are already configured with the correct URLs. The `.env.local` files use `localhost`, while `.env.production` files use your Vercel URLs.

---

## 💻 Local Development

### Running Locally

**Frontend:**
```bash
# In the root directory
npm run dev
```
This will use `.env.local` automatically and connect to `http://localhost:3001` for the backend.

**Backend:**
```bash
# In the server directory
cd server
npm run dev
```
This will use `server/.env.local` and allow connections from `http://localhost:5173`.

### Testing Locally

1. Start the backend server first (port 3001)
2. Start the frontend server (port 5173)
3. Open `http://localhost:5173` in your browser
4. The app should connect to your local backend

---

## 📦 GitHub Setup

### 1. Initialize Git (if not already done)

```bash
git init
git add .
git commit -m "Initial commit - Mamba TikTok Reporting App"
```

### 2. Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it something like `mamba-tiktok-dashboard`
3. **Do NOT** initialize with README, .gitignore, or license (you already have these)

### 3. Push to GitHub

```bash
# Replace YOUR_USERNAME and YOUR_REPO with your actual values
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

> **Important:** Your `.env`, `.env.local`, and `.env.production` files are in `.gitignore` and will NOT be pushed to GitHub. This is for security.

---

## ☁️ Vercel Deployment

### Frontend Deployment

1. **Go to [Vercel](https://vercel.com)** and sign in
2. Click **"Add New Project"**
3. Import your GitHub repository
4. **Configure the project:**
   - **Framework Preset:** Vite
   - **Root Directory:** `./` (leave as default)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

5. **Add Environment Variables:**
   Click "Environment Variables" and add these (copy from `.env.production`):
   ```
   VITE_SUPABASE_URL=https://gyqxjiautgejnrctynic.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cXhqaWF1dGdlam5yY3R5bmljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NjYxMzUsImV4cCI6MjA4MDU0MjEzNX0.ipHFReV3rkaD5MXy8TbWQzDaNiCmsyzCMhPWn-5T348
   VITE_API_BASE_URL=https://tiktok-dashboard-backend.vercel.app
   ```

6. Click **"Deploy"**

### Backend Deployment

1. **Go to [Vercel](https://vercel.com)** and click **"Add New Project"**
2. Import the **same GitHub repository**
3. **Configure the project:**
   - **Framework Preset:** Other
   - **Root Directory:** `server`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

4. **Add Environment Variables:**
   Click "Environment Variables" and add these (copy from `server/.env.production`):
   ```
   PORT=3001
   NODE_ENV=production
   TIKTOK_SHOP_APP_KEY=6i8139mutf5j9
   TIKTOK_SHOP_APP_SECRET=19e3733266a7a95ecd46022e79a915cbb4d9cdaa
   TIKTOK_SHOP_REDIRECT_URI=https://tiktok-dashboard-backend.vercel.app/api/tiktok-shop/auth/callback
   TIKTOK_SHOP_API_BASE=https://open-api.tiktokglobalshop.com
   TIKTOK_AUTH_BASE=https://auth.tiktok-shops.com
   SUPABASE_URL=https://gyqxjiautgejnrctynic.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cXhqaWF1dGdlam5yY3R5bmljIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDk2NjEzNSwiZXhwIjoyMDgwNTQyMTM1fQ.D0rBs3hjoyzcvg36xRvWodYXkp_7eK48_eLOHoVGXZY
   FRONTEND_URL=https://tiktok-dashboard-frontend-eight.vercel.app
   ```

5. Click **"Deploy"**

### Verify Deployment URLs

After deployment, verify your URLs match:
- **Frontend:** `https://tiktok-dashboard-frontend-eight.vercel.app`
- **Backend:** `https://tiktok-dashboard-backend.vercel.app`

If they're different, update the environment variables in Vercel accordingly.

---

## 🔄 Switching Between Environments

### Method 1: Using Different .env Files (Recommended)

**For Local Development:**
```bash
# Frontend - automatically uses .env.local
npm run dev

# Backend - automatically uses .env.local
cd server
npm run dev
```

**For Production Build (Testing):**
```bash
# Frontend - uses .env.production
npm run build
npm run preview

# Backend - uses .env.production
cd server
npm run build
npm start
```

### Method 2: Manual Environment File Switching

If you need to test production settings locally:

1. **Rename your current `.env.local` to `.env.local.backup`**
2. **Copy `.env.production` to `.env.local`**
3. **Run your dev server**
4. **When done, restore `.env.local.backup` to `.env.local`**

### Environment Variables Explained

| Variable | Local Value | Production Value |
|----------|-------------|------------------|
| `VITE_API_BASE_URL` | `http://localhost:3001` | `https://tiktok-dashboard-backend.vercel.app` |
| `FRONTEND_URL` (backend) | `http://localhost:5173` | `https://tiktok-dashboard-frontend-eight.vercel.app` |
| `TIKTOK_SHOP_REDIRECT_URI` | `http://localhost:3001/api/tiktok-shop/auth/callback` | `https://tiktok-dashboard-backend.vercel.app/api/tiktok-shop/auth/callback` |

---

## 🔐 Security Notes

- ✅ `.env`, `.env.local`, and `.env.production` are in `.gitignore`
- ✅ Never commit sensitive keys to GitHub
- ✅ Always use Vercel's Environment Variables UI for production secrets
- ✅ The CORS configuration supports both local and production URLs

---

## 🐛 Troubleshooting

### CORS Errors

If you see CORS errors:
1. Check that the backend's `FRONTEND_URL` matches your frontend URL
2. Verify the frontend's `VITE_API_BASE_URL` matches your backend URL
3. The backend now supports both local and production URLs automatically

### Environment Variables Not Loading

**Vite (Frontend):**
- Vite only loads `.env.local` in development mode
- In production builds, it uses `.env.production`
- All frontend env vars must start with `VITE_`

**Express (Backend):**
- The backend uses `dotenv` which loads `.env` by default
- For local dev, rename `.env.local` to `.env`
- For production, Vercel uses the Environment Variables UI

### TikTok OAuth Redirect Issues

Make sure to update your TikTok App settings:
1. Go to TikTok Developer Portal
2. Update the redirect URI to match your production backend:
   `https://tiktok-dashboard-backend.vercel.app/api/tiktok-shop/auth/callback`

---

## 📝 Quick Reference

### Local Development
```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend
npm run dev
```

### Deploy Updates
```bash
git add .
git commit -m "Your commit message"
git push
```
Vercel will automatically redeploy on push!

---

## ✅ Checklist

- [ ] Pushed code to GitHub
- [ ] Deployed frontend to Vercel
- [ ] Deployed backend to Vercel
- [ ] Added all environment variables in Vercel
- [ ] Verified frontend URL: `https://tiktok-dashboard-frontend-eight.vercel.app`
- [ ] Verified backend URL: `https://tiktok-dashboard-backend.vercel.app`
- [ ] Updated TikTok App redirect URI
- [ ] Tested login functionality
- [ ] Tested TikTok OAuth connection

---

**Need Help?** Check the existing documentation:
- [DEPLOYMENT_GUIDE.md](file:///Users/david/Documents/Mamba/DEPLOYMENT_GUIDE.md)
- [TIKTOK_OAUTH_SETUP.md](file:///Users/david/Documents/Mamba/TIKTOK_OAUTH_SETUP.md)
