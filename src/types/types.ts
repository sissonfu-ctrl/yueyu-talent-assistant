export type ArtistType = 'singer' | 'musician';
export type ScheduleCycleType = 'weekly' | 'monthly';
export type PoolType = 'closed' | 'open';
export type AvailabilityType = 'fixed' | 'temporary';
export type ScheduleStatus = 'draft' | 'published';

export interface Bar {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  schedule_cycle_type: ScheduleCycleType;
  sessions_per_night: number;
  pool_type: PoolType;
  default_price_per_show: number;
  rest_days: number[]; // 0=周日,1=周一...6=周六
  created_at: string;
  user_id: string;
}

export interface BarSession {
  id: string;
  bar_id: string;
  weekday: number | null; // 0-6, null = 通用配置
  session_number: number;
  session_name: string | null;
  start_time: string | null;
  end_time: string | null;
  singers_per_session: number; // 每节需几人
  style_tags: string[]; // 节次风格需求
  created_at: string;
}

export interface Artist {
  id: string;
  name: string;
  phone: string | null;
  type: ArtistType;
  style_tags: string[];
  fixed_bar_id: string | null;
  created_at: string;
  user_id: string;
}

export interface ArtistAvailability {
  id: string;
  artist_id: string;
  availability_type: AvailabilityType;
  day_of_week: number | null;
  specific_date: string | null;
  available_start: string | null;
  available_end: string | null;
  is_available: boolean;
  note: string | null;
  created_at: string;
}

export interface ArtistBarLink {
  artist_id: string;
  bar_id: string;
}

export interface BarArtistPrice {
  bar_id: string;
  artist_id: string;
  price_per_show: number;
}

export interface Schedule {
  id: string;
  bar_id: string;
  period_type: ScheduleCycleType;
  period_label: string;
  period_start: string;
  period_end: string;
  status: ScheduleStatus;
  is_current: boolean;
  created_at: string;
  user_id: string;
}

export interface ScheduleAssignment {
  id: string;
  schedule_id: string;
  date: string;
  session_id: string;
  artist_id: string | null;
  external_name: string | null;
  external_price: number | null;
  is_substitute: boolean;
  is_locked: boolean;
  created_at: string;
}

export interface SettlementRecord {
  id: string;
  schedule_id: string;
  artist_id: string | null;
  external_name: string | null;
  total_shows: number;
  price_per_show: number;
  total_amount: number;
  note: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  created_at: string;
}

export interface ScheduleCell {
  date: string;
  sessionId: string;
  assignments: ScheduleAssignment[];
  availableArtists: Artist[];
}
