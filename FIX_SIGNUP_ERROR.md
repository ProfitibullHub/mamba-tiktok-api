# 🔧 Fix Signup Error - Run This SQL

Copy and paste this SQL into your Supabase SQL Editor to fix the signup error:

```sql
-- Drop existing trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create updated function that creates both profile and account
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  user_role TEXT;
  new_account_id UUID;
  account_name TEXT;
  account_handle TEXT;
BEGIN
  -- Determine role: profitibull.com users are admins, others are clients
  IF NEW.email LIKE '%@profitibull.com' THEN
    user_role := 'admin';
  ELSE
    user_role := 'client';
  END IF;
  
  -- Create profile
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    user_role
  )
  ON CONFLICT (id) DO NOTHING;
  
  -- Generate account name and handle
  account_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s TikTok';
  account_handle := '@' || split_part(NEW.email, '@', 1);
  
  -- Create a personal TikTok account for the user
  INSERT INTO public.accounts (name, tiktok_handle, status)
  VALUES (account_name, account_handle, 'active')
  RETURNING id INTO new_account_id;
  
  -- Link the account to the user
  INSERT INTO public.user_accounts (user_id, account_id)
  VALUES (NEW.id, new_account_id)
  ON CONFLICT (user_id, account_id) DO NOTHING;
  
  -- If admin, also give access to all existing accounts
  IF user_role = 'admin' THEN
    INSERT INTO public.user_accounts (user_id, account_id)
    SELECT NEW.id, id FROM accounts WHERE id != new_account_id
    ON CONFLICT (user_id, account_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the signup
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## Steps:

1. Go to: https://supabase.com/dashboard/project/kgfnluwjsswttpctheml/editor
2. Click "SQL Editor"
3. Copy the SQL above
4. Paste and click "Run"
5. Try signing up again!

This will:
- ✅ Create your profile
- ✅ Create a personal TikTok account for you
- ✅ Link it to your user
- ✅ Handle errors gracefully
