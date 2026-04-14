# Vercel Deployment Guide

This guide will help you deploy your TikTok Dashboard to Vercel. You will deploy the Frontend and Backend as two separate Vercel projects from the same repository.

## Prerequisites

- A [Vercel Account](https://vercel.com/signup)
- Your project pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Deploy the Backend

1.  Go to your Vercel Dashboard and click **"Add New..."** -> **"Project"**.
2.  Import your Git repository.
3.  **Configure Project:**
    - **Project Name:** `tiktok-dashboard-backend` (or similar)
    - **Framework Preset:** Select **"Other"** (or leave as default if it detects Node.js)
    - **Root Directory:** Click "Edit" and select `server`.
    - **Build Command:** `npm run build`
    - **Output Directory:** `dist`
    - **Install Command:** `npm install`
4.  **Environment Variables:**
    Add the following variables (copy from your `server/.env`):
    - `PORT`: `3001` (Optional, Vercel handles this)
    - `FRONTEND_URL`: `https://your-frontend-project.vercel.app` (You will update this later after deploying frontend)
    - `SUPABASE_URL`: `your_supabase_url`
    - `SUPABASE_ANON_KEY`: `your_supabase_anon_key`
    - `TIKTOK_CLIENT_KEY`: `your_tiktok_client_key`
    - `TIKTOK_CLIENT_SECRET`: `your_tiktok_client_secret`
    - `TIKTOK_REDIRECT_URI`: `https://your-backend-project.vercel.app/api/tiktok/auth/callback` (Update this in TikTok Developer Portal too!)
5.  Click **"Deploy"**.

## Step 2: Deploy the Frontend

1.  Go to your Vercel Dashboard and click **"Add New..."** -> **"Project"**.
2.  Import the **same** Git repository again.
3.  **Configure Project:**
    - **Project Name:** `tiktok-dashboard-frontend` (or similar)
    - **Framework Preset:** **Vite**
    - **Root Directory:** Leave as `./` (root)
    - **Build Command:** `npm run build`
    - **Output Directory:** `dist`
    - **Install Command:** `npm install`
4.  **Environment Variables:**
    - `VITE_SUPABASE_URL`: `your_supabase_url`
    - `VITE_SUPABASE_ANON_KEY`: `your_supabase_anon_key`
    - `VITE_TIKTOK_API_URL`: `https://your-backend-project.vercel.app` (The URL from Step 1)
5.  Click **"Deploy"**.

## Step 3: Final Configuration

1.  **Update Backend Environment Variable:**
    - Go to your **Backend Project** in Vercel -> Settings -> Environment Variables.
    - Update `FRONTEND_URL` to your actual Frontend URL (e.g., `https://tiktok-dashboard-frontend.vercel.app`).
    - Redeploy the Backend (Deployment -> Redeploy) for changes to take effect.

2.  **Update TikTok Developer Portal:**
    - Go to [TikTok for Developers](https://developers.tiktok.com/).
    - Update your App's **Redirect URI** to match your Backend URL:
      `https://your-backend-project.vercel.app/api/tiktok/auth/callback`

## Troubleshooting

- **CORS Errors:** Ensure `FRONTEND_URL` in Backend Env Vars matches your Frontend URL exactly (no trailing slash).
- **404 on Refresh:** The `vercel.json` in the root directory handles SPA routing. Ensure it is present.
- **Backend 404:** Ensure you are accessing `/api/...` routes. The root `/` of the backend might not return anything unless you add a route for it.
