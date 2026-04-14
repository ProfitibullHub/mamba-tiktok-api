import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, error: 'No authorization header' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, error: 'No token provided' });
        }

        let user: any = null;
        let authError: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await supabase.auth.getUser(token);
            user = result.data?.user;
            authError = result.error;
            if (user || (authError && !authError.message?.includes('fetch failed'))) break;
            if (attempt === 0) console.log('[Auth] Retrying getUser after transient error...');
        }

        if (authError || !user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        // Check Super Admin membership (new RBAC system)
        const { data: membership } = await supabase
            .from('tenant_memberships')
            .select('id, roles!inner(name), tenants!inner(type)')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .eq('roles.name', 'Super Admin')
            .eq('tenants.type', 'platform')
            .limit(1)
            .maybeSingle();

        // Legacy fallback: profiles.role = 'admin'
        let legacyAdmin = false;
        if (!membership) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            legacyAdmin = profile?.role === 'admin';
        }

        if (!membership && !legacyAdmin) {
            return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
        }

        (req as any).user = user;
        (req as any).isSuperAdmin = !!membership;
        next();
    } catch (error: any) {
        console.error('Admin middleware error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
