/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** When "true" or "1", team permission ceiling + directory use Edge Functions (see supabase/functions/). */
    readonly VITE_TEAM_ROLES_VIA_EDGE?: string;
}
