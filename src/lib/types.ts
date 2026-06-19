export type EntityType = 'artist' | 'track' | 'album' | 'genre';
export type Metric = 'minutes' | 'plays' | 'qualified_plays' | 'unique_tracks' | 'skip_rate';

export type RankingRow = {
  entity_id: string;
  entity_name: string;
  minutes: number;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number;
  known_skip_count: number;
  unknown_duration_plays: number;
};

export type CalendarDay = {
  local_date: string;
  minutes: number;
  plays: number;
};

export type OverviewPayload = {
  generated_at: string;
  timezone: string;
  sync: {
    last_success_at: string | null;
    gap_risk: boolean;
    latest_exact_export_event_at: string | null;
    api_only_period_start: string | null;
  };
  today: {
    minutes: number;
    top_artist: string | null;
    top_track: string | null;
    top_genre: string | null;
  };
  this_week: {
    minutes: number;
    top_artists: RankingRow[];
    top_genres: RankingRow[];
    top_tracks: RankingRow[];
  };
  last_30_days: {
    minutes: number;
    top_artists: RankingRow[];
    top_genres: RankingRow[];
  };
  calendar: {
    last_365_days: CalendarDay[];
  };
};

export type ActivityRow = {
  id: number;
  played_at: string;
  local_date: string;
  track_id: number | null;
  track_name: string | null;
  artist_id: number | null;
  artist_name: string | null;
  album_id: number | null;
  album_name: string | null;
  album_image_url?: string | null;
  source: number;
  data_quality: number;
  ms_played: number | null;
  inferred_ms_played: number | null;
  skipped: boolean | null;
  context_uri: string | null;
  context_type: string | null;
};

export type Profile = {
  user_id: string;
  slug: string;
  display_name: string;
  is_public: boolean;
};

export type PublicProfileOption = Pick<Profile, 'slug' | 'display_name'> & {
  generated_at: string;
};

export type SpotifyConnectionStatus = {
  user_id: string;
  spotify_user_id: string | null;
  spotify_display_name: string | null;
  scopes: string[];
  sync_enabled: boolean;
  connected_at: string;
  last_token_refresh_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  updated_at: string;
};
