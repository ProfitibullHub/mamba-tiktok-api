export interface TikTokAuthTokens {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    open_id: string;
}

export interface TikTokUserInfo {
    open_id: string;
    union_id: string;
    avatar_url: string;
    display_name: string;
    bio_description: string;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    is_verified: boolean;
}

export interface TikTokVideo {
    id: string;
    create_time: number;
    cover_image_url: string;
    share_url: string;
    video_description: string;
    duration: number;
    height: number;
    width: number;
    title: string;
    embed_html: string;
    embed_link: string;
    like_count: number;
    comment_count: number;
    share_count: number;
    view_count: number;
}

export interface TikTokVideoAnalytics {
    video_id: string;
    like_count: number;
    comment_count: number;
    share_count: number;
    view_count: number;
    engagement_rate: number;
}

export interface DatabaseAuthToken {
    id: string;
    account_id: string;
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_at: string;
    scope: string;
    open_id: string;
    created_at: string;
    updated_at: string;
}
