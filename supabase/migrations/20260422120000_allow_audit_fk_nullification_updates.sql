-- Keep audit tables append-only, but allow FK-driven nullification updates
-- (ON DELETE SET NULL on referenced parent rows like tenants/accounts/users).

CREATE OR REPLACE FUNCTION public.prevent_audit_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_row jsonb := to_jsonb(OLD);
    new_row jsonb := to_jsonb(NEW);
BEGIN
    -- Allow referential nullification updates only (no content edits).
    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'tenant_branding_audit' THEN
            -- Allowed only when FK nullification is the only change.
            IF (new_row - 'tenant_id' - 'actor_user_id') = (old_row - 'tenant_id' - 'actor_user_id')
               AND (NEW.tenant_id IS NULL OR NEW.tenant_id = OLD.tenant_id)
               AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id = OLD.actor_user_id) THEN
                RETURN NEW;
            END IF;
        ELSIF TG_TABLE_NAME = 'audit_logs' THEN
            -- Allowed only when FK nullification is the only change.
            IF (new_row - 'tenant_id' - 'account_id' - 'actor_user_id') =
               (old_row - 'tenant_id' - 'account_id' - 'actor_user_id')
               AND (NEW.tenant_id IS NULL OR NEW.tenant_id = OLD.tenant_id)
               AND (NEW.account_id IS NULL OR NEW.account_id = OLD.account_id)
               AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id = OLD.actor_user_id) THEN
                RETURN NEW;
            END IF;
        END IF;
    END IF;

    RAISE EXCEPTION 'Audit rows are immutable and cannot be modified or deleted';
END;
$$;
