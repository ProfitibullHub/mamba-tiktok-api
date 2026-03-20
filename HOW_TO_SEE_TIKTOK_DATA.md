# How to See Your Real TikTok Data

## ✅ Step 1: Sync Your TikTok Data

After connecting your TikTok account, you MUST click **"Sync Now"** to fetch your data:

1. Go to your dashboard
2. Look for the **TikTok Analytics** section at the top
3. Find the **"Sync Now"** button
4. Click it and wait for the sync to complete

## ✅ Step 2: Check Your Data

After syncing, you should see:

### In the "TikTok Analytics (Real-time)" section:
- ✅ Your real follower count
- ✅ Following count
- ✅ Total likes
- ✅ Video count
- ✅ Total views, likes, comments, shares from all your videos
- ✅ Average engagement rate

### The "Key Metrics" section below shows:
- Sample data from the old `kpi_metrics` table (this is separate from TikTok data)
- This is for tracking other metrics like revenue, ad spend, etc.

## 🔍 Troubleshooting

### I don't see a "Sync Now" button
- Make sure you're on the **Overview** tab
- Look in the **TikTok Analytics (Real-time)** section
- The button should be visible after connecting

### Sync button says "Syncing..."
- Wait for it to complete
- It may take 10-30 seconds depending on how many videos you have
- Don't refresh the page

### Still seeing zeros in TikTok Analytics
1. Check if you clicked "Sync Now"
2. Check browser console for errors (F12 → Console tab)
3. Make sure backend server is running
4. Make sure ngrok tunnel is active

### How to verify data was synced

Open browser console (F12) and run:
```javascript
fetch('http://localhost:3001/api/tiktok/user/YOUR_ACCOUNT_ID')
  .then(r => r.json())
  .then(console.log)
```

Replace `YOUR_ACCOUNT_ID` with your actual account ID.

You should see your TikTok data with real follower counts!

## 📊 What Data You'll See

- **Follower Count**: Your current TikTok followers
- **Following Count**: How many accounts you follow
- **Total Likes**: Total likes across your account
- **Video Count**: Number of videos you've posted
- **Total Views**: Sum of views across all your videos
- **Total Engagement**: Sum of likes + comments + shares
- **Avg Engagement Rate**: Average engagement across all videos

All this data comes directly from TikTok's API! 🎉
