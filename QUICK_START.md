# 🚀 Quick Start - Deployment Guide

## For Local Testing

```bash
# Start backend (Terminal 1)
cd server
npm run dev

# Start frontend (Terminal 2)
npm run dev
```

Visit: `http://localhost:5173`

---

## For GitHub & Vercel Deployment

### 1️⃣ Push to GitHub

```bash
git add .
git commit -m "Setup deployment configuration"
git push origin main
```

### 2️⃣ Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repo
3. **Root Directory:** `./`
4. **Framework:** Vite
5. Add environment variables from `.env.production`:
   ```
   VITE_SUPABASE_URL=https://gyqxjiautgejnrctynic.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cXhqaWF1dGdlam5yY3R5bmljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NjYxMzUsImV4cCI6MjA4MDU0MjEzNX0.ipHFReV3rkaD5MXy8TbWQzDaNiCmsyzCMhPWn-5T348
   VITE_API_BASE_URL=https://tiktok-dashboard-backend.vercel.app
   ```
6. Deploy!

### 3️⃣ Deploy Backend to Vercel

1. Add new project in Vercel
2. Import same GitHub repo
3. **Root Directory:** `server`
4. **Framework:** Other
5. Add environment variables from `server/.env.production`:
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
6. Deploy!

---

## 🔄 Switch Between Local & Production

Use the quick switcher script:

```bash
./switch-env.sh
```

Or manually:
- **Local:** Use `.env.local` files
- **Production:** Use `.env.production` files

---

## 📚 Full Documentation

See [DEPLOYMENT_SETUP.md](file:///Users/david/Documents/Mamba/DEPLOYMENT_SETUP.md) for complete details.
