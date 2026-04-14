-- Policy note: shop write access (Node: check_user_account_write_access) intentionally
-- matches read visibility except Seller User. Account Manager & Account Coordinator keep
-- write access for assigned sellers until product owners tighten per-role rules.

COMMENT ON FUNCTION public.check_user_account_write_access(uuid, uuid) IS
    'True if p_user_id may mutate shop data for p_account_id. Same as account visibility (Seller Admin, Agency Admin, Account Manager & Coordinator with assignment, Super Admin, legacy admin) but false when the user has Seller User on that account''s seller tenant.';
