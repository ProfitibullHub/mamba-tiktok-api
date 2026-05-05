-- M2: Agency logo in private Storage + tenant_branding.logo_object_path (server-only access via service role + signed URLs).

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS logo_object_path text;

COMMENT ON COLUMN public.tenant_branding.logo_object_path IS
    'Object path within Storage bucket tenant-branding-logos (e.g. {agency_uuid}/{file_id}.png). Null when no logo.';

-- Path must be {uuid}/filename with safe filename chars (server enforces on write).
ALTER TABLE public.tenant_branding
    DROP CONSTRAINT IF EXISTS tenant_branding_logo_object_path_shape;

ALTER TABLE public.tenant_branding
    ADD CONSTRAINT tenant_branding_logo_object_path_shape CHECK (
        logo_object_path IS NULL
        OR (
            logo_object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-zA-Z0-9._-]+$'
        )
    );

-- Private bucket: app server uses service role to upload/remove; clients read via short-lived signed URLs from API.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'tenant-branding-logos',
    'tenant-branding-logos',
    false,
    2097152,
    ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
