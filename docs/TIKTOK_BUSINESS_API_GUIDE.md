# TikTok Business API Implementation Guide

## 📋 Overview

This guide explains how to integrate and use TikTok Business API (Marketing API) in Mamba to track ad campaigns, spending, conversions, and ROI.

---

## 🚀 Quick Start

### 1. **Database Setup**

Run the migration script in Supabase SQL Editor:

```bash
# File: server/scripts/create_tiktok_ads_tables.sql
```

This creates the following tables:
- `tiktok_advertisers` - TikTok advertiser account credentials
- `tiktok_ad_campaigns` - Ad campaigns
- `tiktok_ad_groups` - Ad groups/ad sets
- `tiktok_ads` - Individual ads/creatives
- `tiktok_ad_metrics` - Performance metrics (daily snapshots)
- `tiktok_ad_spend_daily` - Aggregated daily spend

---

## 🔑 Get TikTok Business API Credentials

### Step 1: Create a TikTok for Business Developer Account

1. Go to [TikTok for Business Marketing API](https://business-api.tiktok.com/)
2. Click "Apply for Access"
3. Fill out the application form
4. Wait for approval (usually 1-3 business days)

### Step 2: Create an App

1. Once approved, go to [TikTok for Business Developer Portal](https://business-api.tiktok.com/portal/apps)
2. Click "Create new app"
3. Fill in the app details:
   - **App Name**: Mamba Analytics
   - **Description**: TikTok Shop analytics and ad tracking
   - **Redirect URI**: `https://mamba-frontend.vercel.app/auth/tiktok-ads/callback`
     (Replace with your production frontend URL)

4. Save the **App ID** and **Secret**

### Step 3: Get Advertiser Authorization

**IMPORTANT**: You were given these credentials from your client:
```
App ID: 7598356547388391440
Secret: 67f5ed778669660c03779dfc5e292121b1ff57d3
Redirect URI: https://mamba-frontend.vercel.app/
```

Use these in your `.env` configuration!

---

## ⚙️ Configuration

### Local Development (.env.local)

Add to `server/.env.local`:

```bash
# TikTok Business API (Marketing API)
TIKTOK_BUSINESS_APP_ID=7598356547388391440
TIKTOK_BUSINESS_SECRET=67f5ed778669660c03779dfc5e292121b1ff57d3
TIKTOK_BUSINESS_REDIRECT_URI=http://localhost:5173/auth/tiktok-ads/callback
```

### Production (Vercel Environment Variables)

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add the following variables:

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `TIKTOK_BUSINESS_APP_ID` | `7598356547388391440` | Production, Preview |
| `TIKTOK_BUSINESS_SECRET` | `67f5ed778669660c03779dfc5e292121b1ff57d3` | Production, Preview |
| `TIKTOK_BUSINESS_REDIRECT_URI` | `https://mamba-frontend.vercel.app/auth/tiktok-ads/callback` | Production |

**⚠️ IMPORTANT**: Make sure to set these for **BOTH** Production AND Preview environments!

---

## 🔗 Connect Advertiser Account

### From Frontend (User Flow):

1. User clicks "Connect TikTok Ads" button
2. Frontend calls: `POST /api/tiktok-ads/auth/start` with `accountId`
3. Backend returns authorization URL
4. User is redirected to TikTok authorization page
5. User grants access
6. TikTok redirects to callback URL with `auth_code`
7. Backend exchanges code for access token
8. Access token is stored in `tiktok_advertisers` table

### Example Implementation:

**Frontend (React):**
```typescript
const connectTikTokAds = async () => {
  const response = await fetch(`${API_URL}/api/tiktok-ads/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: currentAccount.id })
  });
  
  const { authUrl } = await response.json();
  window.location.href = authUrl;
};
```

**Callback Page (React):**
```typescript
// In /auth/tiktok-ads/callback route
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('auth_code')) {
    // Backend handles the callback automatically
    // Just redirect to dashboard
    setTimeout(() => {
      window.location.href = '/dashboard?tiktok_ads_connected=true';
    }, 2000);
  }
}, []);
```

---

## 📊 API Endpoints

### Authentication

#### Start OAuth Flow
```
POST /api/tiktok-ads/auth/start
Body: { "accountId": "uuid" }
Response: { "authUrl": "https://business-api.tiktok.com/portal/auth?..." }
```

#### OAuth Callback
```
GET /api/tiktok-ads/auth/callback?auth_code=XXX&state=YYY
```

#### Get Connection Status
```
GET /api/tiktok-ads/status/:accountId
Response: {
  "connected": true,
  "advertiser": {
    "advertiser_id": "123456",
    "advertiser_name": "My Business",
    "currency": "USD",
    "balance": 1000.00
  }
}
```

### Data Sync

#### Sync Campaigns & Metrics
```
POST /api/tiktok-ads/sync/:accountId
Body: {
  "startDate": "2024-01-01", // Optional, defaults to last 30 days
  "endDate": "2024-01-31"    // Optional, defaults to today
}
Response: {
  "campaigns": 5,
  "adGroups": 15,
  "ads": 45,
  "metricsRecords": 150
}
```

#### Get Ad Spend
```
GET /api/tiktok-ads/spend/:accountId?startDate=2024-01-01&endDate=2024-01-31
Response: {
  "daily": [...],
  "totals": {
    "total_spend": 5000.00,
    "total_impressions": 1000000,
    "total_clicks": 25000,
    "total_conversions": 500,
    "conversion_value": 15000.00
  },
  "average_cpc": 0.20,
  "average_cpm": 5.00,
  "roas": 3.00
}
```

#### Get Campaigns with Metrics
```
GET /api/tiktok-ads/campaigns/:accountId?startDate=2024-01-01&endDate=2024-01-31
Response: [
  {
    "campaign_id": "123",
    "campaign_name": "Summer Sale",
    "status": "ENABLE",
    "metrics": {
      "impressions": 100000,
      "clicks": 5000,
      "spend": 500.00,
      "conversions": 50,
      "conversion_value": 1500.00
    }
  }
]
```

#### Get Overview/Summary
```
GET /api/tiktok-ads/overview/:accountId?startDate=2024-01-01&endDate=2024-01-31
Response: {
  "connected": true,
  "metrics": {
    "total_spend": 5000.00,
    "total_impressions": 1000000,
    "total_clicks": 25000,
    "ctr": 2.5,
    "cpc": 0.20,
    "cpm": 5.00,
    "conversions": 500,
    "conversion_rate": 2.0,
    "roas": 3.0
  },
  "campaigns": {
    "active": 3,
    "total": 5
  }
}
```

---

## 💰 Integration with Profit & Loss

### Ad Spend in P&L Statement

The ad spend is automatically integrated into the P&L calculation:

1. **Fetch ad spend** for selected date range
2. **Subtract from net profit**:
   ```
   Net Profit (Final) = Settlement Amount - COGS - Ad Spend
   ```

3. **Display breakdown**:
   - Total Ad Spend
   - Ad-Attributed Revenue (conversion value)
   - ROAS (Return on Ad Spend)

---

## 📈 Available Metrics

### Campaign Metrics
- `impressions` - Number of times ad was shown
- `clicks` - Number of clicks on ad
- `reach` - Unique users who saw ad
- `frequency` - Average times each user saw ad
- `ctr` - Click-through rate (%)
- `cpc` - Cost per click
- `cpm` - Cost per 1000 impressions

### Engagement Metrics
- `likes`, `comments`, `shares` - Social engagement
- `follows` - New followers from ad
- `video_views` - Video view count
- `video_watched_2s`, `video_watched_6s` - Video engagement
- `video_views_p25/50/75/100` - Video completion rates

### Conversion Metrics
- `conversions` - Total conversions tracked
- `conversion_rate` - Conversion rate (%)
- `cost_per_conversion` - Cost per conversion
- `conversion_value` - Total value from conversions
- `roas` - Return on Ad Spend

---

## 🎨 Frontend Components Needed

### 1. Connect Button (in Settings or Overview)
```tsx
{!adsConnected && (
  <button onClick={connectTikTokAds}>
    Connect TikTok Ads
  </button>
)}
```

### 2. Marketing Dashboard View
- Campaign list with metrics
- Spend chart over time
- ROAS/ROI metrics
- Top performing campaigns

### 3. P&L Integration
Add ad spend section:
```tsx
<div className="border-t pt-4">
  <h4>Marketing Costs</h4>
  <div>
    <span>TikTok Ad Spend</span>
    <span>-${adSpend.toFixed(2)}</span>
  </div>
  <div>
    <span>ROAS</span>
    <span>{roas.toFixed(2)}x</span>
  </div>
</div>
```

---

## 🔄 Data Sync Workflow

### Recommended Sync Schedule:

1. **Daily Auto-Sync**:
   - Sync yesterday's metrics every morning
   - Update campaign/ad group/ad changes

2. **Manual Sync**:
   - User clicks "Sync Now" button
   - Fetches latest data from TikTok

3. **Initial Sync**:
   - When user first connects: sync last 365 days
   - Backfill historical data

### Sync Function Example:

```typescript
const syncAdsData = async () => {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  await fetch(`${API_URL}/api/tiktok-ads/sync/${accountId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: thirtyDaysAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    })
  });
};
```

---

## 🐛 Troubleshooting

### "Advertiser not found"
- Make sure OAuth flow completed successfully
- Check `tiktok_advertisers` table has entry for your account

### "Missing app credentials"
- Verify `TIKTOK_BUSINESS_APP_ID` and `TIKTOK_BUSINESS_SECRET` are set in `.env`

### "Invalid access token"
- Access tokens may expire
- Implement refresh token logic or re-authenticate user

### No metrics data
- Run POST `/api/tiktok-ads/sync/:accountId` to fetch data
- Verify campaigns exist and have metrics in TikTok Ads Manager

---

## 📝 Next Steps

1. ✅ Run database migration (`create_tiktok_ads_tables.sql`)
2. ✅ Add environment variables to Vercel
3. ⏳ Create frontend "Marketing" view component
4. ⏳ Add "Connect TikTok Ads" button
5. ⏳ Integrate ad spend into P&L view
6. ⏳ Create callback route handler
7. ⏳ Test OAuth flow
8. ⏳ Implement auto-sync cron job

---

## 📚 Resources

- [TikTok Business API Docs](https://business-api.tiktok.com/portal/docs)
- [TikTok Marketing API Guide](https://ads.tiktok.com/marketing_api/docs)
- [OAuth 2.0 Flow](https://business-api.tiktok.com/portal/docs?id=1738855176671234)
- [Reporting API](https://business-api.tiktok.com/portal/docs?id=1738864915188737)

---

**Created by:** Mamba Development Team  
**Last Updated**: 2026-01-30
