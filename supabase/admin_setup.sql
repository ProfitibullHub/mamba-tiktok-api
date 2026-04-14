-- 1. Update profiles table role constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'client', 'moderator', 'accountant'));

-- 2. Create default admin user
-- NOTE: This script assumes you are running it in the Supabase SQL Editor.
-- It will create a user in auth.users and a corresponding profile in public.profiles.
-- The password 'admin' is hashed using the standard Supabase/PostgreSQL crypt function.

DO $$
DECLARE
  new_user_id UUID := uuid_generate_v4();
BEGIN
  -- Check if admin already exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@mamba.com') THEN
    -- Insert into auth.users
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'admin@mamba.com',
      crypt('admin', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"System Admin"}',
      now(),
      now(),
      'authenticated',
      '',
      '',
      '',
      ''
    );

    -- Insert into public.profiles
    INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
    VALUES (new_user_id, 'admin@mamba.com', 'System Admin', 'admin', now(), now());
    
    RAISE NOTICE 'Admin user created with ID: %', new_user_id;
  ELSE
    RAISE NOTICE 'Admin user already exists';
  END IF;
END $$;
