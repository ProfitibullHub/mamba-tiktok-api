import axios from 'axios';
import crypto from 'crypto';
import { tiktokConfig } from '../config/tiktok';
import type { TikTokAuthTokens, TikTokUserInfo, TikTokVideo } from '../types/tiktok.types';

export class TikTokAPIService {
    /**
     * Generate PKCE code verifier and challenge
     */
    generatePKCE(): { codeVerifier: string; codeChallenge: string } {
        // Generate random code verifier (43-128 characters)
        const codeVerifier = crypto.randomBytes(32).toString('base64url');

        // Generate code challenge (SHA256 hash of verifier)
        const codeChallenge = crypto
            .createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');

        return { codeVerifier, codeChallenge };
    }

    /**
     * Exchange authorization code for access tokens
     */
    async getAccessToken(code: string, codeVerifier: string): Promise<TikTokAuthTokens> {
        try {
            const response = await axios.post(
                tiktokConfig.tokenUrl,
                {
                    client_key: tiktokConfig.clientKey,
                    client_secret: tiktokConfig.clientSecret,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: tiktokConfig.redirectUri,
                    code_verifier: codeVerifier,
                },
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            if (response.data.error) {
                throw new Error(`TikTok API Error: ${response.data.error_description || response.data.error}`);
            }

            return {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                token_type: response.data.token_type,
                expires_in: response.data.expires_in,
                scope: response.data.scope,
                open_id: response.data.open_id,
            };
        } catch (error: any) {
            console.error('Error getting access token:', error.response?.data || error.message);
            throw new Error(`Failed to get access token: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * Refresh an expired access token
     */
    async refreshAccessToken(refreshToken: string): Promise<TikTokAuthTokens> {
        try {
            const response = await axios.post(
                tiktokConfig.tokenUrl,
                {
                    client_key: tiktokConfig.clientKey,
                    client_secret: tiktokConfig.clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                },
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            if (response.data.error) {
                throw new Error(`TikTok API Error: ${response.data.error_description || response.data.error}`);
            }

            return {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                token_type: response.data.token_type,
                expires_in: response.data.expires_in,
                scope: response.data.scope,
                open_id: response.data.open_id,
            };
        } catch (error: any) {
            console.error('Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh token: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * Get user information including follower count
     */
    async getUserInfo(accessToken: string): Promise<TikTokUserInfo> {
        try {
            const response = await axios.get(
                `${tiktokConfig.apiBaseUrl}/v2/user/info/`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    params: {
                        fields: 'open_id,union_id,avatar_url,display_name,bio_description,follower_count,following_count,likes_count,video_count,is_verified',
                    },
                }
            );

            // Log full response for debugging
            console.log('TikTok API Response:', JSON.stringify(response.data, null, 2));

            // Check for ACTUAL error (TikTok returns error.code='ok' for success!)
            if (response.data.error && response.data.error.code !== 'ok') {
                console.error('TikTok API returned error:', response.data.error);
                throw new Error(`TikTok API Error: ${response.data.error.message || response.data.error.code || JSON.stringify(response.data.error)}`);
            }

            // Check if data exists
            if (!response.data.data || !response.data.data.user) {
                console.error('Unexpected API response structure:', response.data);
                throw new Error('Invalid API response: missing user data');
            }

            const userData = response.data.data.user;
            console.log(`✅ Successfully fetched user data: ${userData.display_name} (${userData.follower_count} followers)`);

            return {
                open_id: userData.open_id,
                union_id: userData.union_id || '',
                avatar_url: userData.avatar_url || '',
                display_name: userData.display_name || '',
                bio_description: userData.bio_description || '',
                follower_count: userData.follower_count || 0,
                following_count: userData.following_count || 0,
                likes_count: userData.likes_count || 0,
                video_count: userData.video_count || 0,
                is_verified: userData.is_verified || false,
            };
        } catch (error: any) {
            console.error('Error getting user info:', error.response?.data || error.message);
            throw new Error(`Failed to get user info: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    /**
     * Get list of user's videos with pagination
     */
    async getVideoList(accessToken: string, cursor?: number, maxCount: number = 20): Promise<{ videos: TikTokVideo[]; cursor: number; hasMore: boolean }> {
        try {
            const response = await axios.post(
                `${tiktokConfig.apiBaseUrl}/v2/video/list/`,
                {
                    max_count: maxCount,
                    cursor: cursor || 0,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    params: {
                        fields: 'id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_html,embed_link,like_count,comment_count,share_count,view_count',
                    },
                }
            );

            // Check for ACTUAL error (TikTok returns error.code='ok' for success!)
            if (response.data.error && response.data.error.code !== 'ok') {
                throw new Error(`TikTok API Error: ${response.data.error.message || response.data.error.code}`);
            }

            const videos = (response.data.data.videos || []).map((video: any) => ({
                id: video.id,
                create_time: video.create_time,
                cover_image_url: video.cover_image_url || '',
                share_url: video.share_url || '',
                video_description: video.video_description || '',
                duration: video.duration || 0,
                height: video.height || 0,
                width: video.width || 0,
                title: video.title || '',
                embed_html: video.embed_html || '',
                embed_link: video.embed_link || '',
                like_count: video.like_count || 0,
                comment_count: video.comment_count || 0,
                share_count: video.share_count || 0,
                view_count: video.view_count || 0,
            }));

            return {
                videos,
                cursor: response.data.data.cursor || 0,
                hasMore: response.data.data.has_more || false,
            };
        } catch (error: any) {
            console.error('Error getting video list:', error.response?.data || error.message);
            throw new Error(`Failed to get video list: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    /**
     * Generate OAuth authorization URL with PKCE
     */
    generateAuthUrl(csrfToken: string, codeChallenge: string, accountId?: string): string {
        const params = new URLSearchParams({
            client_key: tiktokConfig.clientKey,
            scope: tiktokConfig.scopes,
            response_type: 'code',
            redirect_uri: tiktokConfig.redirectUri,
            state: JSON.stringify({ csrf: csrfToken, accountId }),
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        return `${tiktokConfig.authUrl}?${params.toString()}`;
    }
}

export const tiktokAPI = new TikTokAPIService();
