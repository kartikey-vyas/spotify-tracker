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

export type ProfileDateSpan = {
  start: string;
  end: string;
};

export type MonthlyTimelineBucket = {
  month_start: string;
  minutes: number;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number;
  known_skip_count: number;
  unknown_duration_plays: number;
};

export type ArtistDetail = {
  summary: RankingRow | null;
  albums: RankingRow[];
  tracks: RankingRow[];
  monthly: MonthlyTimelineBucket[];
};

/** One non-empty hour of the listening clock: local hour (0..23) and its plays. */
export type ClockBucket = {
  hour: number;
  plays: number;
};

/** Plays of music released in a given year (compilations excluded). */
export type ReleaseYearBucket = {
  year: number;
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
    /** Full daily history; present once the clock/release migration has run. */
    daily?: CalendarDay[];
    /** Legacy field on caches built before that migration. */
    last_365_days?: CalendarDay[];
  };
  /** Optional: absent on caches built before these viz shipped. */
  clock?: ClockBucket[];
  release_years?: ReleaseYearBucket[];
};

/** A play-weighted median of Last.fm artist listeners over one window. */
export type PopularitySummary = {
  /** Null when no play in the window has a listener count. */
  median_artist_listeners: number | null;
  plays: number;
  /** Plays whose primary artist has a Last.fm listener count. */
  covered_plays: number;
};

export type PopularityYear = PopularitySummary & { year: number };

export type DeepCut = {
  spotify_track_id: string | null;
  track_name: string;
  artist_id: number | null;
  artist_name: string | null;
  plays: number;
  track_listeners: number;
};

export type HourTagPart = 'late_night' | 'morning' | 'day' | 'evening' | 'night';

export type HourTagLabel = {
  label: string;
  plays: number;
  /** Adjusted lift: how much more than usual this label plays in the part. */
  lift: number;
};

export type HourTagBucket = {
  part: HourTagPart;
  first_hour: number;
  last_hour: number;
  plays: number;
  /** Empty when the part has too few plays or nothing stands out. */
  labels: HourTagLabel[];
};

/** The daily 'public_insights:<user_id>' cache row. */
export type InsightsPayload = {
  generated_at: string;
  timezone: string;
  source: 'lastfm';
  /** The newest Last.fm stats day behind this person's artists; counts are as
      of then, not as of when they played. */
  stats_observed_through: string | null;
  popularity: {
    all_time: PopularitySummary | null;
    last_30_days: PopularitySummary | null;
    by_year: PopularityYear[];
    deep_cuts: DeepCut[];
  };
  hour_tags: HourTagBucket[];
};

/** One public profile's all-time score, for the comparison strip. */
export type PopularityStripRow = {
  slug: string;
  display_name: string;
  all_time: PopularitySummary | null;
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
