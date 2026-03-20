# 📸 Vercel Environment Variables - Visual Guide

## 🎯 Goal
Add TikTok Business API credentials to Vercel so your deployed backend can access ad campaign data.

---

## 📋 Step-by-Step Instructions

### **Step 1: Login to Vercel**
1. Go to: https://vercel.com
2. Click **Login** (top right)
3. Sign in with your account

---

### **Step 2: Find Your Project**
1. You'll see your **Dashboard** with all projects
2. Look for your backend project (likely named "mamba-backend" or "mamba-server")
3. Click on the project card

---

### **Step 3: Open Settings**
1. At the top of the project page, you'll see tabs: **Overview**, **Deployments**, **Analytics**, **Settings**
2. Click **Settings**

---

### **Step 4: Go to Environment Variables**
1. In the left sidebar under Settings, click **Environment Variables**
2. You'll see a page with:
   - A text input for "Key" (variable name)
   - A text input for "Value" (variable value)
   - Checkboxes for environments (Production, Preview, Development)

---

### **Step 5: Add Variable #1 - App ID**

1. **Key (Name)**: Type exactly: `TIKTOK_BUSINESS_APP_ID`
2. **Value**: Paste: `7598356547388391440`
3. **Select Environments**:
   - ✅ Check **Production**
   - ✅ Check **Preview**
   - ⬜ Leave **Development** unchecked (optional)
4. Click **Add** or **Save**

You should see a success message and the variable listed below.

---

### **Step 6: Add Variable #2 - Secret**

1. **Key**: Type exactly: `TIKTOK_BUSINESS_SECRET`
2. **Value**: Paste: `67f5ed778669660c03779dfc5e292121b1ff57d3`
3. **Environments**:
   - ✅ **Production**
   - ✅ **Preview**
4. Click **Add**

---

### **Step 7: Add Variable #3 - Redirect URI**

1. **Key**: Type exactly: `TIKTOK_BUSINESS_REDIRECT_URI`
2. **Value**: Type: `https://mamba-frontend.vercel.app/auth/tiktok-ads/callback`
   
   ⚠️ **IMPORTANT**: Replace `mamba-frontend.vercel.app` with YOUR actual frontend URL!
   
3. **Environments**:
   - ✅ **Production** only (for now)
4. Click **Add**

**For Preview environment**: Add another variable with the same name but use your preview URL.

---

### **Step 8: Verify Variables Are Added**

Scroll down on the Environment Variables page. You should now see **3 variables** listed:

```
✅ TIKTOK_BUSINESS_APP_ID       (Production, Preview)
✅ TIKTOK_BUSINESS_SECRET        (Production, Preview)
✅ TIKTOK_BUSINESS_REDIRECT_URI  (Production)
```

---

### **Step 9: Redeploy Your Backend**

⚠️ **IMPORTANT**: Variables only take effect after redeployment!

1. Click **Deployments** tab (at the top)
2. Find the most recent deployment (top of list)
3. Click the **⋯** (three dots) button on the right
4. Click **Redeploy**
5. Confirm by clicking **Redeploy** again

Wait ~1-2 minutes for deployment to finish.

---

### **Step 10: Test It's Working** ✅

Open your browser and navigate to:
```
https://your-backend-url.vercel.app/health
```

You should see:
```json
{
  "status": "ok",
  "timestamp": "2026-01-30T...",
  "service": "Mamba - TikTok Shop Dashboard Backend"
}
```

Now test the ads endpoint:
```
https://your-backend-url.vercel.app/api/tiktok-ads/status/any-uuid-here
```

You should see:
```json
{
  "success": true,
  "connected": false
}
```

✅ If you see this, **it's working!** The error would say "Missing app credentials" if variables weren't set.

---

## 🎉 You're Done!

Your backend can now:
- ✅ Authenticate users with TikTok for Business
- ✅ Fetch ad campaign data
- ✅ Track ad spend and conversions
- ✅ Calculate ROAS

---

## 🔍 Common Mistakes to Avoid

### ❌ **Mistake #1**: Typos in variable names
**Solution**: Copy-paste from `VERCEL_ENV_TIKTOK_ADS.txt`

### ❌ **Mistake #2**: Forgetting to redeploy
**Solution**: Always redeploy after adding variables!

### ❌ **Mistake #3**: Wrong Vercel project
**Solution**: Make sure you're in the **backend** project, not frontend

### ❌ **Mistake #4**: Wrong redirect URI
**Solution**: Must match YOUR actual frontend URL exactly

---

## 📞 Need Help?

**Can't find Environment Variables?**
- Make sure you're in **Settings** → **Environment Variables**
- Try refreshing the page

**Variables not working?**
- Check spellings are EXACT (case-sensitive)
- Make sure you redeployed after adding them
- Wait 2-3 minutes after redeployment

**Still stuck?**
- Check full guide: `docs/TIKTOK_BUSINESS_API_GUIDE.md`
- Check deployment logs in Vercel for errors

---

## 📚 What's Next?

1. ✅ Variables added to Vercel
2. ⏳ Run database migration (Supabase)
3. ⏳ Create frontend components
4. ⏳ Test OAuth flow

See: `TIKTOK_ADS_IMPLEMENTATION_SUMMARY.md` for complete todo list.

---

**Created**: 2026-01-30  
**Last Updated**: 2026-01-30
