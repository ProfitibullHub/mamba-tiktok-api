# 🚀 QUICK: How to Add TikTok Ads API to Vercel

## Step 1: Go to Vercel Dashboard
Visit: https://vercel.com/dashboard

## Step 2: Select Your Project
Click on "Mamba" project (or your backend project)

## Step 3: Go to Settings → Environment Variables
Click: **Settings** → **Environment Variables**

## Step 4: Add These 3 Variables

### Variable 1:
- **Name**: `TIKTOK_BUSINESS_APP_ID`
- **Value**: `7598356547388391440`
- **Environments**: ✅ Production, ✅ Preview

### Variable 2:
- **Name**: `TIKTOK_BUSINESS_SECRET`
- **Value**: `67f5ed778669660c03779dfc5e292121b1ff57d3`
- **Environments**: ✅ Production, ✅ Preview

### Variable 3:
- **Name**: `TIKTOK_BUSINESS_REDIRECT_URI`
- **Value**: `https://mamba-frontend.vercel.app/auth/tiktok-ads/callback`
- **Environments**: ✅ Production

**For Preview environment**, use:
```
https://your-preview-url.vercel.app/auth/tiktok-ads/callback
```

## Step 5: Save & Redeploy

1. Click **Save** on each variable
2. Go to **Deployments** tab
3. Click **⋯** (three dots) on latest deployment
4. Click **Redeploy**

## ✅ Done!

Your backend now has access to TikTok Business API credentials.

---

## 📝 How to Verify It's Working

### Test the API:

```bash
# Check health
curl https://your-backend.vercel.app/health

# Test ads status (replace YOUR_ACCOUNT_ID)
curl https://your-backend.vercel.app/api/tiktok-ads/status/YOUR_ACCOUNT_ID
```

**Expected Response**:
```json
{
  "success": true,
  "connected": false
}
```

(Will be `true` after user connects their ad account)

---

## 🐛 Troubleshooting

**Problem**: "Missing app credentials" error

**Solution**:
1. Verify all 3 variables are added
2. Check spellings are EXACT (case-sensitive)
3. Redeploy after adding variables

**Problem**: Variables not showing up

**Solution**:
- Make sure you selected the right Vercel project
- Check you're in "Settings" → "Environment Variables"
- Try refreshing the page

---

**Need Help?** Check: `docs/TIKTOK_BUSINESS_API_GUIDE.md`
