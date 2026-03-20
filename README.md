# TikTok Agency Dashboard

A comprehensive multi-tenant TikTok analytics dashboard built for agencies managing multiple client accounts.

## Features

- **Multi-Account Management**: Support for up to 15 different TikTok accounts
- **Role-Based Access Control**:
  - **Admins**: View all 15 accounts and switch between them
  - **Clients**: View only their assigned account(s)
- **Comprehensive Analytics**:
  - Overview dashboard with key metrics
  - Ads performance tracking
  - Content (posts) analytics
  - Engagement metrics
  - Affiliate marketing data
  - Sales performance
- **Real-time Data**: Powered by Supabase for instant updates
- **Secure Authentication**: Email/password authentication with Row Level Security
- **Beautiful UI**: Modern design with Tailwind CSS and smooth animations

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Authentication**: Supabase Auth

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Supabase account and project

### Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**

   Your `.env` file should already be configured with:
   ```
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Database Setup**

   The database schema has already been applied and includes:
   - `profiles` table (user profiles with roles)
   - `accounts` table (TikTok accounts/stores)
   - `user_accounts` table (user-to-account assignments)
   - `kpi_metrics` table (all performance data)

4. **Create Test Users**

   In your Supabase Dashboard:
   - Go to Authentication > Users
   - Create test users with email/password
   - After creating a user, manually insert their profile:
   ```sql
   INSERT INTO profiles (id, email, full_name, role)
   VALUES ('user-id-from-auth', 'user@example.com', 'User Name', 'admin');
   -- or role = 'client' for client users
   ```

5. **Seed Sample Data**

   Use the provided `seed-data.sql` as a reference to create:
   - Sample TikTok accounts
   - Link users to accounts via `user_accounts`
   - Generate KPI metrics for testing

6. **Run the Application**
   ```bash
   npm run dev
   ```

## Database Structure

### Tables Overview

- **profiles**: User information with role (admin/client)
- **accounts**: TikTok store/account information
- **user_accounts**: Junction table linking users to their accessible accounts
- **kpi_metrics**: All performance metrics organized by account, date, and type

### Metric Types

- `overview`: General performance across all categories
- `ads`: Advertising campaign metrics
- `posts`: Content performance data
- `engagement`: User interaction metrics
- `affiliates`: Affiliate marketing data
- `sales`: Sales and revenue data

## User Roles

### Admin
- Can view all 15 accounts
- Can switch between accounts using the account selector
- Has full visibility across the platform

### Client
- Can only view assigned account(s)
- Single-account clients see their account automatically
- Multi-account clients can switch between their assigned accounts

## Key Metrics Tracked

- **Revenue & Sales**: Total revenue, conversions, average order value
- **Engagement**: Likes, comments, shares, followers gained
- **Ads**: Impressions, clicks, spend, ROAS, CTR
- **Content**: Video views, posts published, engagement rate
- **Affiliates**: Commission earned, conversion rate, clicks
- **Performance**: ROI, profit margins, conversion rates

## Security

- Row Level Security (RLS) enabled on all tables
- Users can only access data they're authorized to see
- Authentication required for all dashboard access
- Secure password handling via Supabase Auth

## Customization

### Adding New Accounts

```sql
INSERT INTO accounts (name, tiktok_handle, status)
VALUES ('New Account Name', '@tiktokhandle', 'active');
```

### Assigning Accounts to Users

```sql
INSERT INTO user_accounts (user_id, account_id)
VALUES ('user-id', 'account-id');
```

### Adding KPI Data

```sql
INSERT INTO kpi_metrics (
  account_id, date, metric_type,
  impressions, clicks, conversions, revenue, spend,
  engagement_rate, followers_gained, video_views,
  likes, comments, shares, affiliate_commissions
)
VALUES (
  'account-id', CURRENT_DATE, 'overview',
  50000, 2500, 125, 3750.00, 500.00,
  5.5, 250, 45000, 2200, 180, 95, 375.00
);
```

## Building for Production

```bash
npm run build
```

The build output will be in the `dist/` directory.

## Support

For issues or questions, please contact your development team.
# Mamba
# Mamba
# Mamba
