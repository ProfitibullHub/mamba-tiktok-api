# TikTok Production OAuth Setup Checklist

## ✅ Step 1: Verify Client Key

1. Go to TikTok Shop Partner Center → App Management
2. Copy the **Production** App Key
3. Verify it matches `TIKTOK_SHOP_APP_KEY` in your `.env` file.

---

## ✅ Step 2: Add Redirect URI in App Settings

**CRITICAL**: Must be EXACT match (including https, path, no trailing slash)

1. Go to App Settings → Developer Configuration
2. Add this EXACT redirect URI:
   ```
   https://tiktok-dashboard-backend.vercel.app/api/tiktok-shop/auth/callback
   ```
   (Or your production backend URL)
3. Click **"Save"**

---

## ✅ Step 3: Enable Required Scopes

Ensure your app has approval for these scopes:
- `user.info.basic`
- `video.list`
- `seller.order.list`
- `seller.product.list`
- `seller.finance.list`

---

## ✅ Step 4: Verify App Status

Make sure your app status shows:
- "Live" or "Published"

---

## ✅ Step 5: Test the OAuth Flow

1. Go to your production frontend URL
2. Click "Connect TikTok Shop"
3. Log in with a real TikTok Shop seller account

---

## 📝 Current Configuration

**Backend (.env):**
- App Key: (Check your .env)
- Redirect URI: `https://tiktok-dashboard-backend.vercel.app/api/tiktok-shop/auth/callback`
