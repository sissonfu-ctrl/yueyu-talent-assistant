
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  phone text,
  role public.user_role DEFAULT 'user'::public.user_role,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    'user'::public.user_role
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = uid;
$$;

CREATE VIEW public_profiles AS
  SELECT id, role FROM profiles;

CREATE TABLE public.bars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  contact text,
  schedule_cycle_type text NOT NULL CHECK (schedule_cycle_type IN ('weekly', 'monthly')),
  sessions_per_night int NOT NULL DEFAULT 3,
  pool_type text NOT NULL DEFAULT 'open' CHECK (pool_type IN ('closed', 'open')),
  default_price_per_show numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  type text NOT NULL CHECK (type IN ('singer', 'musician')),
  genre_tags text[] DEFAULT '{}',
  fixed_bar_id uuid REFERENCES public.bars(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.artist_bar_links (
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  PRIMARY KEY (artist_id, bar_id)
);

CREATE TABLE public.artist_availabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  availability_type text NOT NULL CHECK (availability_type IN ('fixed', 'temporary')),
  day_of_week int CHECK (day_of_week >= 0 AND day_of_week <= 6),
  specific_date date,
  available_start time,
  available_end time,
  is_available boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  session_number int NOT NULL,
  session_name text,
  start_time time,
  end_time time,
  singer_count int NOT NULL DEFAULT 1,
  required_genres text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(bar_id, session_number)
);

CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  period_type text NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  date date NOT NULL,
  session_id uuid NOT NULL REFERENCES public.bar_sessions(id) ON DELETE CASCADE,
  artist_id uuid REFERENCES public.artists(id) ON DELETE SET NULL,
  external_name text,
  external_price numeric,
  is_substitute boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bar_artist_prices (
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  price_per_show numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (bar_id, artist_id)
);

CREATE TABLE public.settlement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  artist_id uuid REFERENCES public.artists(id) ON DELETE SET NULL,
  external_name text,
  total_shows int NOT NULL DEFAULT 0,
  price_per_show numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz DEFAULT now()
);
