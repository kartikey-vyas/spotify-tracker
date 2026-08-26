const MUSICBRAINZ_API_ROOT = 'https://musicbrainz.org/ws/2';

export type MusicBrainzArtistCredit = {
  name?: string;
  joinphrase?: string;
  artist?: {
    id?: string;
    name?: string;
    'sort-name'?: string;
    disambiguation?: string;
  };
};

export type MusicBrainzRecording = {
  id: string;
  title: string;
  length?: number | null;
  disambiguation?: string;
  isrcs?: string[];
  'artist-credit'?: MusicBrainzArtistCredit[];
  releases?: unknown[];
  genres?: unknown[];
  tags?: unknown[];
  [key: string]: unknown;
};

export type MusicBrainzIsrcResponse = {
  isrc?: string;
  recordings?: MusicBrainzRecording[];
  [key: string]: unknown;
};

export type TrackMatchInput = {
  name: string;
  durationMs: number | null;
  artistNames: string[];
};

export type ScoredMusicBrainzRecording = {
  mbid: string;
  title: string;
  artistMbids: string[];
  artistNames: string[];
  durationMs: number | null;
  durationDeltaMs: number | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  ambiguous: boolean;
  reasons: string[];
};

export class MusicBrainzHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export function normalizeIsrc(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(normalized) ? normalized : null;
}

export function normalizeMusicName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function normalizeTrackTitle(value: string): string {
  // Spotify commonly appends featured artists to the title while MusicBrainz
  // represents them in artist-credit. Remove only that narrow decoration;
  // remix/live/remaster qualifiers remain significant recording evidence.
  return normalizeMusicName(value.replace(/\s*[([]\s*(?:feat\.?|featuring)\b[^)\]]*[)\]]/giu, ''));
}

function recordingArtistNames(recording: MusicBrainzRecording): string[] {
  return (recording['artist-credit'] ?? [])
    .map((credit) => credit.artist?.name ?? credit.name)
    .filter((name): name is string => Boolean(name));
}

function recordingArtistMbids(recording: MusicBrainzRecording): string[] {
  return (recording['artist-credit'] ?? [])
    .map((credit) => credit.artist?.id)
    .filter((id): id is string => Boolean(id));
}

function confidenceFor(titleExact: boolean, artistExact: boolean, durationDeltaMs: number | null): 'high' | 'medium' | 'low' {
  if (titleExact && artistExact && durationDeltaMs !== null && durationDeltaMs <= 5_000) return 'high';
  if (titleExact && artistExact) return 'medium';
  return 'low';
}

export function scoreMusicBrainzRecordings(
  input: TrackMatchInput,
  recordings: MusicBrainzRecording[]
): ScoredMusicBrainzRecording[] {
  const inputTitle = normalizeMusicName(input.name);
  const inputCanonicalTitle = normalizeTrackTitle(input.name);
  const inputArtists = new Set(input.artistNames.map(normalizeMusicName).filter(Boolean));

  const scored = recordings.map((recording): ScoredMusicBrainzRecording => {
    const reasons: string[] = [];
    const recordingTitle = normalizeMusicName(recording.title);
    const titleExact = recordingTitle === inputTitle || normalizeTrackTitle(recording.title) === inputCanonicalTitle;
    const artistNames = recordingArtistNames(recording);
    const artistExact = artistNames.some((name) => inputArtists.has(normalizeMusicName(name)));
    const durationMs = typeof recording.length === 'number' ? recording.length : null;
    const durationDeltaMs =
      input.durationMs !== null && durationMs !== null ? Math.abs(input.durationMs - durationMs) : null;
    let score = 0;

    if (titleExact) {
      score += 50;
      reasons.push(recordingTitle === inputTitle ? 'exact title' : 'title matches after featured-artist suffix');
    }
    if (artistExact) {
      score += 40;
      reasons.push('artist overlap');
    }
    if (durationDeltaMs !== null) {
      if (durationDeltaMs <= 250) {
        score += 15;
        reasons.push('duration within 250ms');
      } else if (durationDeltaMs <= 1_000) {
        score += 10;
        reasons.push('duration within 1s');
      } else if (durationDeltaMs <= 2_000) {
        score += 7;
        reasons.push('duration within 2s');
      } else if (durationDeltaMs <= 5_000) {
        score += 4;
        reasons.push('duration within 5s');
      } else if (durationDeltaMs <= 10_000) {
        score += 2;
        reasons.push('duration within 10s');
      } else if (durationDeltaMs > 30_000) {
        score -= 10;
        reasons.push('duration differs by more than 30s');
      }
    }

    return {
      mbid: recording.id,
      title: recording.title,
      artistMbids: recordingArtistMbids(recording),
      artistNames,
      durationMs,
      durationDeltaMs,
      score,
      confidence: confidenceFor(titleExact, artistExact, durationDeltaMs),
      ambiguous: false,
      reasons
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (left.durationDeltaMs ?? Number.POSITIVE_INFINITY) - (right.durationDeltaMs ?? Number.POSITIVE_INFINITY);
  });

  if (scored.length > 1 && scored[0].score - scored[1].score <= 3) {
    scored[0].ambiguous = true;
  }

  return scored;
}

export async function lookupMusicBrainzByIsrc(
  isrc: string,
  options: {
    userAgent: string;
    fetchImpl?: typeof fetch;
  }
): Promise<MusicBrainzIsrcResponse> {
  const normalized = normalizeIsrc(isrc);
  if (!normalized) throw new Error(`Invalid ISRC: ${isrc}`);

  const url = new URL(`${MUSICBRAINZ_API_ROOT}/isrc/${normalized}`);
  url.searchParams.set('fmt', 'json');
  // The ISRC resource accepts fewer `inc` values than a direct recording
  // lookup. In particular, it rejects release-groups, genres and tags even
  // though those are valid when looking up a recording MBID.
  url.searchParams.set('inc', 'artist-credits');

  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': options.userAgent
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new MusicBrainzHttpError(`MusicBrainz returned HTTP ${response.status}`, response.status, body);
  }

  try {
    return JSON.parse(body) as MusicBrainzIsrcResponse;
  } catch {
    throw new Error('MusicBrainz returned invalid JSON');
  }
}
