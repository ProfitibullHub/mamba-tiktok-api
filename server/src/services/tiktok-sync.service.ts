import { supabase } from '../config/supabase';
import { tiktokAPI } from './tiktok-api.service';
import type { TikTokUserInfo, TikTokVideo } from '../types/tiktok.types';

export class TikTokSyncService {
    /**
     * Calculate engagement rate from video stats
     */
    private calculateEngagementRate(likes: number, comments: number, shares: number, views: number): number {
        if (views === 0) return 0;
        return ((likes + comments + shares) / views) * 100;
    }

    /**
     * Get valid access token for an account (refresh if needed)
     */
    private async getValidAccessToken(accountId: string): Promise<string> {
        const { data: tokenData, error } = await supabase
            .from('tiktok_auth_tokens')
            .select('*')
            .eq('account_id', accountId)
            .single();

        if (error || !tokenData) {
            throw new Error('No TikTok authentication found for this account');
        }

        const expiresAt = new Date(tokenData.expires_at);
        const now = new Date();

        // Refresh token if it expires in less than 5 minutes
        if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
            console.log(`Refreshing token for account ${accountId}`);
            const newTokens = await tiktokAPI.refreshAccessToken(tokenData.refresh_token);

            const newExpiresAt = new Date(now.getTime() + newTokens.expires_in * 1000);

            await supabase
                .from('tiktok_auth_tokens')
                .update({
                    access_token: newTokens.access_token,
                    refresh_token: newTokens.refresh_token,
                    expires_at: newExpiresAt.toISOString(),
                    updated_at: now.toISOString(),
                })
                .eq('account_id', accountId);

            return newTokens.access_token;
        }

        return tokenData.access_token;
    }

    /**
     * Sync user information and follower count
     */
    async syncUserData(accountId: string): Promise<TikTokUserInfo> {
        try {
            const accessToken = await this.getValidAccessToken(accountId);
            const userInfo = await tiktokAPI.getUserInfo(accessToken);

            // Upsert user info to database
            const { error } = await supabase
                .from('tiktok_user_info')
                .upsert({
                    account_id: accountId,
                    open_id: userInfo.open_id,
                    union_id: userInfo.union_id,
                    display_name: userInfo.display_name,
                    avatar_url: userInfo.avatar_url,
                    bio_description: userInfo.bio_description,
                    follower_count: userInfo.follower_count,
                    following_count: userInfo.following_count,
                    likes_count: userInfo.likes_count,
                    video_count: userInfo.video_count,
                    is_verified: userInfo.is_verified,
                    synced_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }, {
                    onConflict: 'account_id',
                });

            if (error) {
                console.error('Error saving user info:', error);
                throw new Error(`Failed to save user info: ${error.message}`);
            }

            // Update the account with real TikTok data (display name and avatar)
            try {
                const tiktokHandle = userInfo.display_name ? `@${userInfo.display_name.toLowerCase().replace(/\s+/g, '')}` : null;

                await supabase
                    .from('accounts')
                    .update({
                        tiktok_handle: tiktokHandle,
                        avatar_url: userInfo.avatar_url,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', accountId);

                console.log(`Updated account ${accountId} with TikTok handle: ${tiktokHandle}`);
            } catch (updateError) {
                console.error('Error updating account:', updateError);
                // Don't fail the sync if account update fails
            }

            console.log(`Synced user data for account ${accountId}: ${userInfo.follower_count} followers`);
            return userInfo;
        } catch (error: any) {
            console.error(`Error syncing user data for account ${accountId}:`, error.message);
            throw error;
        }
    }

    /**
     * Sync all videos for an account
     */
    async syncVideos(accountId: string): Promise<number> {
        try {
            const accessToken = await this.getValidAccessToken(accountId);
            let cursor: number | undefined = 0;
            let hasMore = true;
            let totalVideos = 0;

            while (hasMore) {
                const { videos, cursor: nextCursor, hasMore: more } = await tiktokAPI.getVideoList(accessToken, cursor, 20);

                for (const video of videos) {
                    // Upsert video data
                    const { error: videoError } = await supabase
                        .from('tiktok_videos')
                        .upsert({
                            account_id: accountId,
                            video_id: video.id,
                            title: video.title,
                            description: video.video_description,
                            cover_image_url: video.cover_image_url,
                            share_url: video.share_url,
                            embed_html: video.embed_html,
                            embed_link: video.embed_link,
                            duration: video.duration,
                            height: video.height,
                            width: video.width,
                            create_time: video.create_time,
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'video_id',
                        });

                    if (videoError) {
                        console.error(`Error saving video ${video.id}:`, videoError);
                        continue;
                    }

                    // Get the video's database ID
                    const { data: videoData } = await supabase
                        .from('tiktok_videos')
                        .select('id')
                        .eq('video_id', video.id)
                        .single();

                    if (videoData) {
                        // Calculate engagement rate
                        const engagementRate = this.calculateEngagementRate(
                            video.like_count,
                            video.comment_count,
                            video.share_count,
                            video.view_count
                        );

                        // Upsert video analytics
                        const { error: analyticsError } = await supabase
                            .from('tiktok_video_analytics')
                            .upsert({
                                video_id: videoData.id,
                                account_id: accountId,
                                like_count: video.like_count,
                                comment_count: video.comment_count,
                                share_count: video.share_count,
                                view_count: video.view_count,
                                engagement_rate: engagementRate,
                                synced_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                            }, {
                                onConflict: 'video_id',
                            });

                        if (analyticsError) {
                            console.error(`Error saving analytics for video ${video.id}:`, analyticsError);
                        }
                    }

                    totalVideos++;
                }

                cursor = nextCursor;
                hasMore = more;

                // Add a small delay to avoid rate limiting
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`Synced ${totalVideos} videos for account ${accountId}`);
            return totalVideos;
        } catch (error: any) {
            console.error(`Error syncing videos for account ${accountId}:`, error.message);
            throw error;
        }
    }

    /**
     * Sync all data for an account (user info + videos)
     */
    async syncAllData(accountId: string): Promise<{ userInfo: TikTokUserInfo; videoCount: number }> {
        console.log(`Starting full sync for account ${accountId}`);

        const userInfo = await this.syncUserData(accountId);
        const videoCount = await this.syncVideos(accountId);

        console.log(`Completed sync for account ${accountId}: ${videoCount} videos, ${userInfo.follower_count} followers`);

        return { userInfo, videoCount };
    }

    /**
     * Get sync status for an account
     */
    async getSyncStatus(accountId: string): Promise<{ lastSync: string | null; videoCount: number; followerCount: number }> {
        const { data: userInfo } = await supabase
            .from('tiktok_user_info')
            .select('synced_at, follower_count')
            .eq('account_id', accountId)
            .single();

        const { count } = await supabase
            .from('tiktok_videos')
            .select('*', { count: 'exact', head: true })
            .eq('account_id', accountId);

        return {
            lastSync: userInfo?.synced_at || null,
            videoCount: count || 0,
            followerCount: userInfo?.follower_count || 0,
        };
    }
}

export const tiktokSyncService = new TikTokSyncService();
export const tiktokSync = tiktokSyncService; // Alias for backward compatibility
