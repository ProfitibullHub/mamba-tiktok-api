import { Router, Request, Response } from 'express';
import { tiktokSync } from '../services/tiktok-sync.service';
import { supabase } from '../config/supabase';

const router = Router();

/**
 * GET /api/tiktok/user/:accountId
 * Get TikTok user info and follower count
 */
router.get('/user/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const { data, error } = await supabase
            .from('tiktok_user_info')
            .select('*')
            .eq('account_id', accountId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                error: 'No TikTok user data found. Please sync first.',
            });
        }

        res.json({
            success: true,
            data,
        });
    } catch (error: any) {
        console.error('Error fetching user data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch user data',
        });
    }
});

/**
 * GET /api/tiktok/videos/:accountId
 * Get list of videos with analytics
 */
router.get('/videos/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { limit = 20, offset = 0 } = req.query;

        const { data: videos, error } = await supabase
            .from('tiktok_videos')
            .select(`
        *,
        analytics:tiktok_video_analytics(*)
      `)
            .eq('account_id', accountId)
            .order('create_time', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (error) {
            throw new Error('Failed to fetch videos');
        }

        res.json({
            success: true,
            data: videos || [],
            pagination: {
                limit: Number(limit),
                offset: Number(offset),
            },
        });
    } catch (error: any) {
        console.error('Error fetching videos:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch videos',
        });
    }
});

/**
 * GET /api/tiktok/analytics/:accountId
 * Get aggregated analytics for an account
 */
router.get('/analytics/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        // Get user info
        const { data: userInfo } = await supabase
            .from('tiktok_user_info')
            .select('*')
            .eq('account_id', accountId)
            .single();

        // Get video count and total analytics
        const { data: videos } = await supabase
            .from('tiktok_videos')
            .select(`
        id,
        analytics:tiktok_video_analytics(
          like_count,
          comment_count,
          share_count,
          view_count,
          engagement_rate
        )
      `)
            .eq('account_id', accountId);

        // Calculate aggregated metrics
        let totalLikes = 0;
        let totalComments = 0;
        let totalShares = 0;
        let totalViews = 0;
        let videoCount = 0;

        if (videos) {
            videos.forEach((video: any) => {
                if (video.analytics && video.analytics.length > 0) {
                    const analytics = video.analytics[0];
                    totalLikes += analytics.like_count || 0;
                    totalComments += analytics.comment_count || 0;
                    totalShares += analytics.share_count || 0;
                    totalViews += analytics.view_count || 0;
                    videoCount++;
                }
            });
        }

        const avgEngagementRate = videoCount > 0
            ? ((totalLikes + totalComments + totalShares) / totalViews) * 100
            : 0;

        res.json({
            success: true,
            data: {
                userInfo: userInfo || null,
                aggregatedMetrics: {
                    videoCount,
                    totalLikes,
                    totalComments,
                    totalShares,
                    totalViews,
                    avgEngagementRate: parseFloat(avgEngagementRate.toFixed(2)),
                },
            },
        });
    } catch (error: any) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch analytics',
        });
    }
});

/**
 * POST /api/tiktok/sync/:accountId
 * Manually trigger data sync for an account
 */
router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { syncType = 'all' } = req.body; // 'all', 'user', or 'videos'

        let result;

        switch (syncType) {
            case 'user':
                result = await tiktokSync.syncUserData(accountId);
                break;
            case 'videos':
                result = await tiktokSync.syncVideos(accountId);
                break;
            case 'all':
            default:
                result = await tiktokSync.syncAllData(accountId);
                break;
        }

        res.json({
            success: true,
            message: 'Sync completed successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Error syncing data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to sync data',
        });
    }
});

/**
 * GET /api/tiktok/sync/status/:accountId
 * Get sync status for an account
 */
router.get('/sync/status/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const status = await tiktokSync.getSyncStatus(accountId);

        res.json({
            success: true,
            data: status,
        });
    } catch (error: any) {
        console.error('Error getting sync status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get sync status',
        });
    }
});

export default router;
