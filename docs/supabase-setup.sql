-- ============================================
-- SubAI Supabase Setup Script
-- Run this in Supabase SQL Editor (Dashboard)
-- ============================================

-- 1. Create profiles table
CREATE TABLE profiles (
  id                      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   text        NOT NULL,
  full_name               text,
  premium_until           timestamptz DEFAULT NULL,
  videos_used_this_month  int         DEFAULT 0,
  usage_reset_at          timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now()
);

-- 2. Create payments table
CREATE TABLE payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES profiles(id),
  payos_order_id  text        UNIQUE,
  amount          int,
  currency        text        DEFAULT 'VND',
  status          text        DEFAULT 'pending',
  paid_at         timestamptz DEFAULT NULL,
  created_at      timestamptz DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for profiles
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 5. RLS Policies for payments
CREATE POLICY "Users can read own payments"
  ON payments FOR SELECT
  USING (auth.uid() = user_id);

-- Note: INSERT/UPDATE on payments is done via service_role key from Flask backend
-- Service role key bypasses RLS automatically

-- 6. Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- 7. Atomic increment function (avoid race conditions)
CREATE OR REPLACE FUNCTION increment_video_count(uid uuid)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET videos_used_this_month = videos_used_this_month + 1
  WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
