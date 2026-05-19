import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolveUserIdFromBearerToken } from '../lib/jwt-session.js';

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

        const userId = await resolveUserIdFromBearerToken(token);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }

        const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId);
        const user = userData?.user;
        if (userErr || !user) {
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
