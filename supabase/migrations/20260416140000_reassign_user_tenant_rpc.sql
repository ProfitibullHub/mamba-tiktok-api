create or replace function public.reassign_user_tenant_for_actor(
    p_actor_id uuid,
    p_user_id uuid,
    p_target_tenant_id uuid,
    p_target_role_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_tenant_type text;
    v_target_role_id uuid;
    v_target_membership_id uuid;
    v_old record;
begin
    if p_actor_id is null then
        raise exception 'Invalid actor';
    end if;
    if p_user_id is null or p_target_tenant_id is null then
        raise exception 'User and target tenant are required';
    end if;
    if p_actor_id = p_user_id then
        raise exception 'You cannot reassign your own tenant';
    end if;

    if not (
        exists (select 1 from public.profiles where id = p_actor_id and role = 'admin')
        or public.user_is_platform_super_admin(p_actor_id)
    ) then
        raise exception 'Only platform admins can transfer tenant membership';
    end if;

    select type into v_target_tenant_type
    from public.tenants
    where id = p_target_tenant_id;

    if v_target_tenant_type is null or v_target_tenant_type not in ('agency', 'seller') then
        raise exception 'Target tenant must be an agency or seller tenant';
    end if;

    select id into v_target_role_id
    from public.roles
    where tenant_id is null
      and name = trim(p_target_role_name)
      and scope = v_target_tenant_type
    limit 1;

    if v_target_role_id is null then
        raise exception 'Target role is invalid for this tenant type';
    end if;

    for v_old in
        select tm.tenant_id
        from public.tenant_memberships tm
        join public.tenants t on t.id = tm.tenant_id
        where tm.user_id = p_user_id
          and tm.status = 'active'
          and t.type in ('agency', 'seller')
          and tm.tenant_id <> p_target_tenant_id
    loop
        perform public.ensure_not_last_admin(v_old.tenant_id, p_user_id, null);
    end loop;

    update public.tenant_memberships tm
    set status = 'deactivated',
        updated_at = now()
    from public.tenants t
    where tm.user_id = p_user_id
      and tm.tenant_id = t.id
      and tm.status = 'active'
      and t.type in ('agency', 'seller')
      and tm.tenant_id <> p_target_tenant_id;

    insert into public.tenant_memberships (tenant_id, user_id, role_id, status)
    values (p_target_tenant_id, p_user_id, v_target_role_id, 'active')
    on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id,
        status = 'active',
        updated_at = now()
    returning id into v_target_membership_id;

    update public.profiles
    set tenant_id = p_target_tenant_id,
        updated_at = now()
    where id = p_user_id;

    if v_target_tenant_type = 'agency' then
        delete from public.user_seller_assignments
        where user_id = p_user_id
          and agency_tenant_id <> p_target_tenant_id;
    else
        delete from public.user_seller_assignments
        where user_id = p_user_id;
    end if;

    return v_target_membership_id;
end;
$$;

revoke all on function public.reassign_user_tenant_for_actor(uuid, uuid, uuid, text) from public;
grant execute on function public.reassign_user_tenant_for_actor(uuid, uuid, uuid, text) to service_role;
