-- Listening insights: a global popularity score and the tags that rise at each
-- part of the day, both built from Last.fm evidence. Plans and the evidence for
-- every threshold are in docs/popularity-score-plan.md and docs/mood-clock-plan.md.
--
-- This lives in its own cache row ('public_insights:<user_id>'), not inside
-- build_overview_payload. That payload is rebuilt on every 15-minute sync and
-- every 3-minute rollup drain, and the drain has hit statement timeouts before.
-- Last.fm counts only move when enrichment runs, so one rebuild a day is fresh
-- enough.
--
-- The raw Last.fm tables stay service-only. The browser only ever sees the
-- finished aggregates, through public_profile_insights.

-- 1. Which Last.fm tags may appear on the hour-tags panel, and under what label.
--    Same shape and privileges as genre_tag_rules. Seeded from the reviewed
--    draft in docs/mood-clock-tags-draft.csv.
create table public.clock_tag_rules (
  normalized_tag text primary key,
  decision text not null,
  category text not null,
  label text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint clock_tag_rules_tag_check
    check (btrim(normalized_tag) <> ''),
  constraint clock_tag_rules_decision_check
    check (
      (decision = 'include' and category in ('style', 'texture', 'mood')
        and label is not null and btrim(label) <> '')
      or (decision = 'exclude' and category in ('place', 'era', 'person_or_label', 'junk')
        and label is null)
    )
);

alter table public.clock_tag_rules enable row level security;
revoke all on table public.clock_tag_rules from anon, authenticated;
grant select, insert, update, delete on table public.clock_tag_rules to service_role;

insert into public.clock_tag_rules (normalized_tag, decision, category, label, notes)
values
  ('hip hop', 'include', 'style', 'hip-hop', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('rap', 'include', 'style', 'hip-hop', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('electronic', 'include', 'style', 'electronic', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('american', 'exclude', 'place', null, null),
  ('experimental', 'include', 'style', 'experimental', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('pop', 'include', 'style', 'pop', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('rnb', 'include', 'style', 'r&b', 'Also in genre_tag_rules.'),
  ('trap', 'include', 'style', 'trap', 'Also in genre_tag_rules.'),
  ('indie', 'include', 'style', 'indie', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('british', 'exclude', 'place', null, null),
  ('underground hip hop', 'include', 'style', 'underground hip-hop', 'Also in genre_tag_rules.'),
  ('experimental hip hop', 'include', 'style', 'experimental hip-hop', 'Also in genre_tag_rules.'),
  ('alternative', 'include', 'style', 'alternative', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('soul', 'include', 'style', 'soul', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('rock', 'include', 'style', 'rock', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('alternative rnb', 'include', 'style', 'alternative r&b', 'Also in genre_tag_rules.'),
  ('house', 'include', 'style', 'house', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('indie rock', 'include', 'style', 'indie rock', 'Also in genre_tag_rules.'),
  ('cloud rap', 'include', 'style', 'cloud rap', 'Also in genre_tag_rules.'),
  ('hardcore hip hop', 'include', 'style', 'hardcore hip-hop', 'Also in genre_tag_rules.'),
  ('ambient', 'include', 'style', 'ambient', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('pop rap', 'include', 'style', 'pop rap', 'Also in genre_tag_rules.'),
  ('electronica', 'include', 'style', 'electronica', 'Umbrella tag; rarely lifts.'),
  ('neo soul', 'include', 'style', 'neo-soul', 'Also in genre_tag_rules.'),
  ('jazz rap', 'include', 'style', 'jazz rap', 'Also in genre_tag_rules.'),
  ('female vocalists', 'include', 'texture', 'female vocalists', null),
  ('united states', 'exclude', 'place', null, null),
  ('instrumental', 'include', 'texture', 'instrumental', null),
  ('dance', 'include', 'style', 'dance', 'Also in genre_tag_rules. Umbrella tag; rarely lifts.'),
  ('alternative rock', 'include', 'style', 'alternative rock', 'Also in genre_tag_rules.'),
  ('psychedelic', 'include', 'style', 'psychedelic', 'Also in genre_tag_rules.'),
  ('gangsta rap', 'include', 'style', 'gangsta rap', null),
  ('lo fi', 'include', 'texture', 'lo-fi', null),
  ('instrumental hip hop', 'include', 'style', 'instrumental hip-hop', 'Also in genre_tag_rules.'),
  ('techno', 'include', 'style', 'techno', 'Also in genre_tag_rules.'),
  ('alternative hip hop', 'include', 'style', 'alternative hip-hop', 'Also in genre_tag_rules.'),
  ('usa', 'exclude', 'place', null, null),
  ('r and b', 'include', 'style', 'r&b', 'Also in genre_tag_rules.'),
  ('downtempo', 'include', 'style', 'downtempo', null),
  ('funk', 'include', 'style', 'funk', null),
  ('new york', 'exclude', 'place', null, null),
  ('indie pop', 'include', 'style', 'indie pop', 'Also in genre_tag_rules.'),
  ('west coast hip hop', 'include', 'style', 'west coast hip-hop', 'Also in genre_tag_rules.'),
  ('jazz', 'include', 'style', 'jazz', 'Also in genre_tag_rules.'),
  ('swag', 'include', 'style', 'swag', 'Used as ''swag rap'' (2010s); borderline.'),
  ('trip hop', 'include', 'style', 'trip-hop', 'Also in genre_tag_rules.'),
  ('art rock', 'include', 'style', 'art rock', 'Also in genre_tag_rules.'),
  ('canadian', 'exclude', 'place', null, null),
  ('glitch hop', 'include', 'style', 'glitch hop', 'Also in genre_tag_rules.'),
  ('synthpop', 'include', 'style', 'synthpop', 'Also in genre_tag_rules.'),
  ('britpop', 'include', 'style', 'britpop', null),
  ('ofwgkta', 'exclude', 'person_or_label', null, null),
  ('beats', 'include', 'style', 'instrumental hip-hop', null),
  ('southern hip hop', 'include', 'style', 'southern hip-hop', null),
  ('trap rap', 'include', 'style', 'trap', 'Also in genre_tag_rules.'),
  ('chillout', 'include', 'mood', 'chill', null),
  ('deep house', 'include', 'style', 'deep house', null),
  ('canada', 'exclude', 'place', null, null),
  ('idm', 'include', 'style', 'idm', 'Also in genre_tag_rules.'),
  ('underground rap', 'include', 'style', 'underground hip-hop', null),
  ('abstract hip hop', 'include', 'style', 'abstract hip hop', null),
  ('singer songwriter', 'include', 'style', 'singer-songwriter', 'Also in genre_tag_rules.'),
  ('japanese', 'exclude', 'place', null, null),
  ('uk garage', 'include', 'style', 'uk garage', null),
  ('industrial hip hop', 'include', 'style', 'industrial hip-hop', 'Also in genre_tag_rules. One listener only.'),
  ('uk', 'exclude', 'place', null, null),
  ('chicago', 'exclude', 'place', null, null),
  ('trance', 'include', 'style', 'trance', 'Also in genre_tag_rules.'),
  ('horrorcore', 'include', 'style', 'horrorcore', null),
  ('atlanta', 'exclude', 'place', null, null),
  ('dream pop', 'include', 'style', 'dream pop', null),
  ('california', 'exclude', 'place', null, null),
  ('electropop', 'include', 'style', 'electropop', null),
  ('west coast', 'include', 'style', 'west coast hip-hop', null),
  ('future garage', 'include', 'style', 'future garage', null),
  ('conscious hip hop', 'include', 'style', 'conscious hip-hop', null),
  ('psychedelic rock', 'include', 'style', 'psychedelic rock', null),
  ('chillwave', 'include', 'style', 'chillwave', null),
  ('dubstep', 'include', 'style', 'dubstep', null),
  ('neo psychedelia', 'include', 'style', 'neo psychedelia', null),
  ('australian', 'exclude', 'place', null, null),
  ('electro', 'include', 'style', 'electro', null),
  ('memphis rap', 'include', 'style', 'memphis rap', null),
  ('kanye west', 'exclude', 'person_or_label', null, null),
  ('noise', 'include', 'style', 'noise', 'Also in genre_tag_rules.'),
  ('vaporwave', 'include', 'style', 'vaporwave', null),
  ('florida', 'exclude', 'place', null, null),
  ('industrial', 'include', 'style', 'industrial', 'Also in genre_tag_rules.'),
  ('dirty south', 'include', 'style', 'southern hip-hop', null),
  ('boyband', 'include', 'style', 'boyband', 'Format more than sound; borderline.'),
  ('japan', 'exclude', 'place', null, null),
  ('post punk', 'include', 'style', 'post-punk', 'Also in genre_tag_rules.'),
  ('dance pop', 'include', 'style', 'dance pop', null),
  ('jazz hop', 'include', 'style', 'jazz hop', null),
  ('psychedelic pop', 'include', 'style', 'psychedelic pop', null),
  ('gay fish', 'exclude', 'junk', null, 'Joke tag on one artist.'),
  ('drum and bass', 'include', 'style', 'drum and bass', null),
  ('east coast', 'include', 'style', 'east coast hip-hop', null),
  ('indiana', 'exclude', 'place', null, null),
  ('breakbeat', 'include', 'style', 'breakbeat', null),
  ('male vocalists', 'include', 'texture', 'male vocalists', 'Excluded from genre_tag_rules as a performer attribute; kept here as texture.'),
  ('east coast hip hop', 'include', 'style', 'east coast hip-hop', null),
  ('psytrance', 'include', 'style', 'psytrance', null),
  ('chill', 'include', 'mood', 'chill', null),
  ('young money', 'exclude', 'person_or_label', null, null),
  ('drake', 'exclude', 'person_or_label', null, null),
  ('bedroom pop', 'include', 'style', 'bedroom pop', 'Also in genre_tag_rules.'),
  ('chillhop', 'include', 'style', 'chillhop', null),
  ('all', 'exclude', 'junk', null, null),
  ('plugg', 'include', 'style', 'plugg', 'Rap microgenre.'),
  ('east coast rap', 'include', 'style', 'east coast hip-hop', null),
  ('folk', 'include', 'style', 'folk', null),
  ('detroit', 'exclude', 'place', null, null),
  ('compton', 'exclude', 'place', null, null),
  ('spazz rap', 'exclude', 'junk', null, 'Single artist, single listener.'),
  ('woman beater', 'exclude', 'junk', null, 'Accusation tag, not sound.'),
  ('rage', 'include', 'style', 'rage', 'Rap microgenre.'),
  ('nu jazz', 'include', 'style', 'nu jazz', 'Also in genre_tag_rules.'),
  ('experimental rap', 'include', 'style', 'experimental hip-hop', 'One listener only.'),
  ('art pop', 'include', 'style', 'art pop', 'Also in genre_tag_rules.'),
  ('jazz fusion', 'include', 'style', 'jazz fusion', 'Also in genre_tag_rules.'),
  ('progressive house', 'include', 'style', 'progressive house', null),
  ('progressive trance', 'include', 'style', 'progressive trance', 'Also in genre_tag_rules.'),
  ('grime', 'include', 'style', 'grime', null),
  ('los angeles', 'exclude', 'place', null, null),
  ('opium', 'exclude', 'person_or_label', null, null),
  ('avant garde', 'include', 'style', 'avant garde', null),
  ('french', 'exclude', 'place', null, null),
  ('drone', 'include', 'style', 'drone', null),
  ('soundtrack', 'include', 'texture', 'soundtrack', null),
  ('space rock', 'include', 'style', 'space rock', null),
  ('boom bap', 'include', 'style', 'boom bap', null),
  ('wonky', 'include', 'style', 'wonky', 'Also in genre_tag_rules.'),
  ('conscious', 'include', 'style', 'conscious hip-hop', 'Only 2 artists.'),
  ('psychedelic trance', 'include', 'style', 'psytrance', 'One listener only.'),
  ('bass', 'include', 'style', 'bass', null),
  ('tech house', 'include', 'style', 'tech house', null),
  ('german', 'exclude', 'place', null, null),
  ('houston', 'exclude', 'place', null, null),
  ('hyperpop', 'include', 'style', 'hyperpop', null),
  ('shoegaze', 'include', 'style', 'shoegaze', 'Also in genre_tag_rules.'),
  ('pop rock', 'include', 'style', 'pop rock', null),
  ('disco', 'include', 'style', 'disco', 'Also in genre_tag_rules.'),
  ('virginia', 'exclude', 'place', null, null),
  ('80s', 'exclude', 'era', null, null),
  ('swedish', 'exclude', 'place', null, null),
  ('handsome', 'exclude', 'junk', null, null),
  ('ugly', 'exclude', 'junk', null, null),
  ('electroclash', 'include', 'style', 'electroclash', null),
  ('clipse', 'exclude', 'person_or_label', null, null),
  ('emo rap', 'include', 'style', 'emo rap', null),
  ('outsider house', 'include', 'style', 'outsider house', null),
  ('uk hip hop', 'include', 'style', 'uk hip-hop', null),
  ('acid', 'include', 'style', 'acid', null),
  ('progressive psytrance', 'include', 'style', 'progressive psytrance', 'One listener only.'),
  ('bubblegum bass', 'include', 'style', 'bubblegum bass', null),
  ('post rock', 'include', 'style', 'post rock', null),
  ('glo fi', 'include', 'style', 'chillwave', null),
  ('jungle', 'include', 'style', 'jungle', null),
  ('alt pop', 'include', 'style', 'alt pop', null),
  ('ambient techno', 'include', 'style', 'ambient techno', null),
  ('travis scott', 'exclude', 'person_or_label', null, null),
  ('math rock', 'include', 'style', 'math rock', null),
  ('nature sounds', 'include', 'texture', 'nature sounds', null),
  ('acoustic', 'include', 'texture', 'acoustic', null),
  ('hardcore', 'include', 'style', 'hardcore', 'Ambiguous: hardcore punk, hardcore techno and hardcore hip-hop.'),
  ('2 step', 'include', 'style', '2 step', null),
  ('hip house', 'include', 'style', 'hip house', 'Also in genre_tag_rules.'),
  ('dreampunk', 'include', 'style', 'dreampunk', 'One listener. One listener only.'),
  ('mf doom', 'exclude', 'person_or_label', null, null),
  ('australia', 'exclude', 'place', null, null),
  ('90s', 'exclude', 'era', null, null),
  ('indietronica', 'include', 'style', 'indietronica', null),
  ('synthwave', 'include', 'style', 'synthwave', 'Also in genre_tag_rules.'),
  ('ambient pop', 'include', 'style', 'ambient pop', null),
  ('punk', 'include', 'style', 'punk', null),
  ('dub', 'include', 'style', 'dub', null),
  ('nu disco', 'include', 'style', 'nu disco', null),
  ('composer', 'exclude', 'junk', null, 'Role, not sound; correlates with classical/soundtrack labels already present.'),
  ('acid techno', 'include', 'style', 'acid techno', 'One listener only.'),
  ('dub techno', 'include', 'style', 'dub techno', null),
  ('glitch', 'include', 'style', 'glitch', 'Also in genre_tag_rules.'),
  ('england', 'exclude', 'place', null, null),
  ('french house', 'include', 'style', 'french house', null),
  ('piano', 'include', 'texture', 'piano', null),
  ('pennsylvania', 'exclude', 'place', null, null),
  ('rave', 'include', 'style', 'rave', null),
  ('finnish', 'exclude', 'place', null, null),
  ('lo fi house', 'include', 'style', 'lo-fi house', null),
  ('electro house', 'include', 'style', 'electro house', null),
  ('minimal', 'include', 'style', 'minimal', 'Mostly minimal techno, some minimalism; borderline.'),
  ('beast coast', 'exclude', 'person_or_label', null, null),
  ('lofi', 'include', 'texture', 'lo-fi', null),
  ('uk bass', 'include', 'style', 'uk bass', null),
  ('latin', 'include', 'style', 'latin', null),
  ('new wave', 'include', 'style', 'new wave', 'Also in genre_tag_rules.'),
  ('korean', 'exclude', 'place', null, null),
  ('lo fi hip hop', 'include', 'texture', 'lo-fi', null),
  ('goa', 'include', 'style', 'goa trance', null),
  ('reggae', 'include', 'style', 'reggae', null),
  ('nature', 'include', 'texture', 'nature sounds', 'One listener only.'),
  ('70s', 'exclude', 'era', null, null),
  ('ambient house', 'include', 'style', 'ambient house', null),
  ('yeah', 'exclude', 'junk', null, null),
  ('scottish', 'exclude', 'place', null, null),
  ('contemporary rnb', 'include', 'style', 'r&b', null),
  ('classic rock', 'include', 'style', 'classic rock', null),
  ('germany', 'exclude', 'place', null, null),
  ('breaks', 'include', 'style', 'breakbeat', null),
  ('dj', 'exclude', 'junk', null, 'Role, not sound.'),
  ('west coast rap', 'include', 'style', 'west coast hip-hop', null),
  ('irish', 'exclude', 'place', null, null),
  ('post dubstep', 'include', 'style', 'post dubstep', null),
  ('producer', 'exclude', 'junk', null, 'Role, not sound.'),
  ('breakcore', 'include', 'style', 'breakcore', null),
  ('southern rap', 'include', 'style', 'southern hip-hop', null),
  ('garage rock', 'include', 'style', 'garage rock', null),
  ('video game music', 'include', 'texture', 'video game music', null),
  ('post hardcore', 'include', 'style', 'post hardcore', null),
  ('lounge', 'include', 'style', 'lounge', null),
  ('progressive', 'exclude', 'junk', null, 'Ambiguous: mixes prog rock and progressive house/trance.'),
  ('ireland', 'exclude', 'place', null, null),
  ('nature sound', 'include', 'texture', 'nature sounds', 'One listener only.'),
  ('stutter house', 'include', 'style', 'stutter house', null),
  ('goa trance', 'include', 'style', 'goa trance', null),
  ('hypnagogic pop', 'include', 'style', 'hypnagogic pop', null),
  ('edm', 'include', 'style', 'edm', null),
  ('def jux', 'exclude', 'person_or_label', null, null),
  ('finland', 'exclude', 'place', null, null),
  ('female vocalist', 'include', 'texture', 'female vocalists', null),
  ('metal', 'include', 'style', 'metal', null),
  ('daft punk', 'exclude', 'person_or_label', null, null),
  ('dnb', 'include', 'style', 'drum and bass', null),
  ('water', 'exclude', 'junk', null, 'Single artist; would make one act the whole label.'),
  ('alternative rap', 'include', 'style', 'alternative hip-hop', null),
  ('blues', 'include', 'style', 'blues', null),
  ('stones throw', 'exclude', 'person_or_label', null, null),
  ('based', 'include', 'style', 'based', 'Lil B''s ''based'' scene; 6 artists, one listener. One listener only.'),
  ('dreamy', 'include', 'mood', 'dreamy', null),
  ('my top songs', 'exclude', 'junk', null, null),
  ('classical', 'include', 'style', 'classical', null),
  ('dark ambient', 'include', 'style', 'dark ambient', null),
  ('uk hiphop', 'include', 'style', 'uk hip-hop', 'Only 1 artists.'),
  ('reggaeton', 'include', 'style', 'reggaeton', null),
  ('united kingdom', 'exclude', 'place', null, null),
  ('dutch', 'exclude', 'place', null, null),
  ('maryland', 'exclude', 'place', null, null),
  ('garage rock revival', 'include', 'style', 'garage rock', 'Only 3 artists.'),
  ('indie folk', 'include', 'style', 'indie folk', 'Also in genre_tag_rules.'),
  ('modern classical', 'include', 'style', 'modern classical', null),
  ('kid cudi', 'exclude', 'person_or_label', null, null),
  ('glitch pop', 'include', 'style', 'glitch pop', null),
  ('comedy', 'include', 'mood', 'funny', 'One listener only.'),
  ('comfy', 'include', 'mood', 'comfy', 'Only 3 artists. One listener only.'),
  ('real recognize real and this nigga the realest', 'exclude', 'junk', null, null),
  ('free jazz', 'include', 'style', 'free jazz', null),
  ('newbreed', 'exclude', 'junk', null, 'Unclear scene/collective tag.'),
  ('black hippy', 'exclude', 'person_or_label', null, null),
  ('future bass', 'include', 'style', 'future bass', null),
  ('underworld', 'exclude', 'person_or_label', null, null),
  ('seapunk', 'include', 'style', 'seapunk', 'Eight artists, one listener. One listener only.'),
  ('vocal trance', 'include', 'style', 'vocal trance', 'Also in genre_tag_rules.'),
  ('drill', 'include', 'style', 'drill', null),
  ('comedy rap', 'include', 'mood', 'funny', 'One listener only.'),
  ('emo', 'include', 'style', 'emo', null),
  ('france', 'exclude', 'place', null, null),
  ('griselda', 'exclude', 'person_or_label', null, null),
  ('glam rock', 'include', 'style', 'glam rock', 'One listener only.'),
  ('minimal techno', 'include', 'style', 'minimal techno', null),
  ('sounds of nature', 'include', 'texture', 'nature sounds', 'One listener only.'),
  ('freak folk', 'include', 'style', 'freak folk', 'One listener only.'),
  ('progressive rock', 'include', 'style', 'progressive rock', null),
  ('saxophone', 'include', 'texture', 'saxophone', null),
  ('texas', 'exclude', 'place', null, null),
  ('post punk revival', 'include', 'style', 'post-punk revival', 'Also in genre_tag_rules.'),
  ('microhouse', 'include', 'style', 'microhouse', null),
  ('hiphop', 'include', 'style', 'hip-hop', null),
  ('psychedelic soul', 'include', 'style', 'psychedelic soul', null),
  ('new zealand', 'exclude', 'place', null, null),
  ('indian', 'exclude', 'place', null, null),
  ('full on', 'include', 'style', 'psytrance', 'One listener only.'),
  ('uk funky', 'include', 'style', 'uk funky', null),
  ('nu metal', 'include', 'style', 'nu metal', null),
  ('vaportrap', 'include', 'style', 'vaportrap', null),
  ('black metal', 'include', 'style', 'black metal', null),
  ('alternative metal', 'include', 'style', 'alternative metal', null),
  ('puerto rico', 'exclude', 'place', null, null),
  ('tde', 'exclude', 'person_or_label', null, null),
  ('alchemist', 'exclude', 'person_or_label', null, null),
  ('danish', 'exclude', 'place', null, null),
  ('noise rock', 'include', 'style', 'noise rock', 'One listener only.'),
  ('hard rock', 'include', 'style', 'hard rock', null),
  ('drumless', 'include', 'texture', 'drumless', 'One listener only.'),
  ('sad', 'include', 'mood', 'sad', null),
  ('new orleans', 'exclude', 'place', null, null),
  ('london', 'exclude', 'place', null, null),
  ('avant garde jazz', 'include', 'style', 'avant garde jazz', null),
  ('pop punk', 'include', 'style', 'pop punk', null),
  ('calm', 'include', 'mood', 'calm', null),
  ('queens', 'exclude', 'place', null, null),
  ('urban', 'exclude', 'junk', null, 'Marketing umbrella, no sound meaning.'),
  ('bay area', 'exclude', 'place', null, null),
  ('the black asap rocky', 'exclude', 'person_or_label', null, null),
  ('neptunes', 'exclude', 'person_or_label', null, null),
  ('post industrial', 'include', 'style', 'post industrial', null),
  ('experimental rock', 'include', 'style', 'experimental rock', null),
  ('frictionless', 'exclude', 'junk', null, null),
  ('2', 'exclude', 'junk', null, null),
  ('brazilian', 'exclude', 'place', null, null),
  ('soprano sax', 'exclude', 'junk', null, 'Single artist (would swamp the saxophone label).'),
  ('georgia', 'exclude', 'place', null, null),
  ('israeli', 'exclude', 'place', null, null),
  ('memphis', 'exclude', 'place', null, null),
  ('lo fi beat', 'include', 'texture', 'lo-fi', null),
  ('detroit techno', 'include', 'style', 'detroit techno', null),
  ('denmark', 'exclude', 'place', null, null),
  ('english', 'exclude', 'place', null, null),
  ('relax', 'include', 'mood', 'relaxing', 'One listener only.'),
  ('eurodance', 'include', 'style', 'eurodance', null),
  ('heavy metal', 'include', 'style', 'heavy metal', null),
  ('trill shit', 'exclude', 'junk', null, null),
  ('country', 'include', 'style', 'country', null),
  ('big beat', 'include', 'style', 'big beat', null),
  ('pittsburgh', 'exclude', 'place', null, null),
  ('latin pop', 'include', 'style', 'latin pop', null),
  ('good', 'exclude', 'junk', null, null),
  ('india', 'exclude', 'place', null, null),
  ('new age', 'include', 'style', 'new age', 'One listener only.'),
  ('rapcore', 'include', 'style', 'rapcore', 'One listener only.'),
  ('dungeon synth', 'include', 'style', 'dungeon synth', 'One listener only.'),
  ('lofi house', 'include', 'style', 'lo-fi house', null),
  ('pop soul', 'include', 'style', 'pop soul', null),
  ('puerto rican', 'exclude', 'place', null, null),
  ('trap latino', 'include', 'style', 'trap latino', null),
  ('j pop', 'include', 'style', 'j-pop', null),
  ('coke rap', 'exclude', 'junk', null, 'Real subgenre but only two artists here.'),
  ('bollywood', 'include', 'style', 'bollywood', 'One listener only.'),
  ('netherlands', 'exclude', 'place', null, null),
  ('contemporary classical', 'include', 'style', 'modern classical', null),
  ('relaxing', 'include', 'mood', 'relaxing', 'One listener only.'),
  ('retrowave', 'include', 'style', 'synthwave', null),
  ('isaiah rashad', 'exclude', 'person_or_label', null, null),
  ('irish hip hop', 'exclude', 'place', null, null),
  ('mumble rap', 'include', 'style', 'mumble rap', null),
  ('dublin', 'exclude', 'place', null, null),
  ('garage', 'exclude', 'junk', null, 'Ambiguous: garage rock vs UK garage.'),
  ('madlib', 'exclude', 'person_or_label', null, null),
  ('anime', 'include', 'style', 'anime', 'Setting/source more than a sound; borderline.'),
  ('phonk', 'include', 'style', 'phonk', null),
  ('plunderphonics', 'include', 'style', 'plunderphonics', null),
  ('progressive electronic', 'include', 'style', 'progressive electronic', 'One listener only.'),
  ('afrobeats', 'include', 'style', 'afrobeats', null),
  ('soft rock', 'include', 'style', 'soft rock', null),
  ('art', 'exclude', 'junk', null, null),
  ('asap mob', 'exclude', 'person_or_label', null, null),
  ('dance punk', 'include', 'style', 'dance punk', null),
  ('detroit electro', 'include', 'style', 'electro', 'Only 3 artists.'),
  ('gospel', 'include', 'style', 'gospel', null),
  ('harlem', 'exclude', 'place', null, null),
  ('latin rap', 'exclude', 'junk', null, 'Two artists; effectively a person tag.'),
  ('go', 'exclude', 'junk', null, null),
  ('deconstructed club', 'include', 'style', 'deconstructed club', null),
  ('hindi', 'exclude', 'place', null, null),
  ('dreamwave', 'include', 'style', 'synthwave', null),
  ('punk rock', 'include', 'style', 'punk rock', null),
  ('psyprog', 'include', 'style', 'progressive psytrance', 'One listener only.'),
  ('composers', 'exclude', 'junk', null, 'Role, not sound.'),
  ('linkin park', 'exclude', 'person_or_label', null, null),
  ('dancehall', 'include', 'style', 'dancehall', null),
  ('lil wayne', 'exclude', 'person_or_label', null, null),
  ('old school', 'exclude', 'era', null, null),
  ('the police', 'exclude', 'person_or_label', null, null),
  ('white', 'exclude', 'junk', null, null),
  ('minimalism', 'include', 'style', 'minimalism', 'One listener only.'),
  ('us', 'exclude', 'place', null, null),
  ('brooklyn', 'exclude', 'place', null, null),
  ('atmospheric', 'include', 'mood', 'atmospheric', null),
  ('san francisco', 'exclude', 'place', null, null),
  ('fusion', 'include', 'style', 'jazz fusion', null),
  ('runescape', 'exclude', 'junk', null, null),
  ('synth pop', 'include', 'style', 'synthpop', null),
  ('sound collage', 'include', 'style', 'plunderphonics', null),
  ('chamber pop', 'include', 'style', 'chamber pop', null),
  ('folk rock', 'include', 'style', 'folk rock', null),
  ('italian', 'exclude', 'place', null, null),
  ('medieval', 'include', 'style', 'medieval', 'Three artists, one listener. Only 3 artists. One listener only.'),
  ('sweden', 'exclude', 'place', null, null),
  ('chillsynth', 'include', 'style', 'synthwave', null),
  ('crunk', 'include', 'style', 'crunk', null),
  ('j rock', 'include', 'style', 'j rock', null),
  ('liquid funk', 'include', 'style', 'liquid dnb', null),
  ('drum n bass', 'include', 'style', 'drum and bass', null),
  ('polish', 'exclude', 'place', null, null),
  ('the cool kids', 'exclude', 'person_or_label', null, null),
  ('g eazy', 'exclude', 'person_or_label', null, null),
  ('impressionism', 'exclude', 'era', null, null),
  ('juvenile', 'exclude', 'person_or_label', null, null),
  ('orchestral', 'include', 'texture', 'orchestral', null),
  ('world', 'include', 'style', 'world', null),
  ('youtube', 'exclude', 'junk', null, null),
  ('chinese', 'exclude', 'place', null, null),
  ('sexy', 'include', 'mood', 'sexy', null),
  ('club', 'include', 'style', 'club', null),
  ('nigerian', 'exclude', 'place', null, null),
  ('north carolina', 'exclude', 'place', null, null),
  ('88rising', 'exclude', 'person_or_label', null, null),
  ('chill hop', 'include', 'style', 'chillhop', null),
  ('queer', 'exclude', 'junk', null, 'Identity of performer, not sound.'),
  ('trillwave', 'include', 'style', 'trillwave', 'One listener. One listener only.'),
  ('acid house', 'include', 'style', 'acid house', null),
  ('belgium', 'exclude', 'place', null, null),
  ('comedy rock', 'exclude', 'junk', null, 'Single artist.'),
  ('illinois', 'exclude', 'place', null, null),
  ('death metal', 'include', 'style', 'death metal', null),
  ('psy trance', 'include', 'style', 'psytrance', 'One listener only.'),
  ('mexican', 'exclude', 'place', null, null),
  ('south korea', 'exclude', 'place', null, null),
  ('ebm', 'include', 'style', 'ebm', 'One listener only.'),
  ('minecraft', 'exclude', 'junk', null, null),
  ('portland', 'exclude', 'place', null, null),
  ('wanttohearagain', 'exclude', 'junk', null, null),
  ('manchester', 'exclude', 'place', null, null),
  ('south sudan', 'exclude', 'place', null, null),
  ('norwegian', 'exclude', 'place', null, null),
  ('turntablism', 'include', 'style', 'turntablism', null),
  ('biracial', 'exclude', 'junk', null, 'Identity of performer, not sound.'),
  ('dope sample', 'exclude', 'junk', null, 'Single artist opinion tag.'),
  ('lil tecca', 'exclude', 'person_or_label', null, null),
  ('melodic death metal', 'include', 'style', 'melodic death metal', null),
  ('ninja tune', 'exclude', 'person_or_label', null, null),
  ('contemporary jazz', 'include', 'style', 'contemporary jazz', null),
  ('party', 'include', 'mood', 'party', null),
  ('j cole', 'exclude', 'person_or_label', null, null),
  ('jangle pop', 'include', 'style', 'jangle pop', null),
  ('spanish', 'exclude', 'place', null, null),
  ('funk rock', 'include', 'style', 'funk rock', null),
  ('afrobeat', 'include', 'style', 'afrobeat', null),
  ('ysl', 'exclude', 'person_or_label', null, null),
  ('colombia', 'exclude', 'place', null, null),
  ('desi', 'exclude', 'place', null, null),
  ('afropop', 'include', 'style', 'afropop', null),
  ('future funk', 'include', 'style', 'future funk', null),
  ('new rave', 'include', 'style', 'new rave', null),
  ('psychedelic folk', 'include', 'style', 'psychedelic folk', 'One listener only.'),
  ('hardcore punk', 'include', 'style', 'hardcore punk', null),
  ('score', 'include', 'texture', 'soundtrack', null),
  ('alternative dance', 'include', 'style', 'alternative dance', null),
  ('future bounce', 'exclude', 'junk', null, 'Single artist.'),
  ('trill', 'exclude', 'junk', null, 'Slang; overlaps person tags.'),
  ('uk rap', 'include', 'style', 'uk hip-hop', null),
  ('acid rap', 'exclude', 'junk', null, 'Two artists; effectively a person tag.'),
  ('colombian', 'exclude', 'place', null, null),
  ('smooth jazz', 'include', 'style', 'smooth jazz', null),
  ('liquid drum and bass', 'include', 'style', 'liquid dnb', null),
  ('dill', 'exclude', 'junk', null, null),
  ('folktronica', 'include', 'style', 'folktronica', null),
  ('mississippi', 'exclude', 'place', null, null),
  ('soundcloud rap', 'include', 'style', 'soundcloud rap', 'One listener only.'),
  ('synth funk', 'include', 'style', 'synth funk', 'Also in genre_tag_rules. Only 3 artists.'),
  ('teen pop', 'include', 'style', 'teen pop', null),
  ('watts', 'exclude', 'place', null, null),
  ('oldies', 'exclude', 'era', null, null),
  ('new jersey', 'exclude', 'place', null, null),
  ('ed banger', 'exclude', 'person_or_label', null, null),
  ('rhythm and blues', 'include', 'style', 'r&b', null),
  ('neosoul', 'include', 'style', 'neo-soul', 'Only 2 artists.'),
  ('rain', 'include', 'texture', 'rain sounds', 'One listener only.'),
  ('romantic', 'include', 'mood', 'romantic', null),
  ('snitch', 'exclude', 'junk', null, 'Accusation tag, not sound.'),
  ('nigeria', 'exclude', 'place', null, null),
  ('spotify', 'exclude', 'junk', null, null),
  ('african', 'exclude', 'place', null, null),
  ('mike will made it', 'exclude', 'person_or_label', null, null),
  ('retro electro', 'include', 'style', 'retro electro', null),
  ('ghana', 'exclude', 'place', null, null),
  ('sophisti pop', 'include', 'style', 'sophisti pop', null),
  ('acid jazz', 'include', 'style', 'acid jazz', null),
  ('atmospheric drum and bass', 'include', 'style', 'liquid dnb', null),
  ('future jazz', 'include', 'style', 'nu jazz', null),
  ('ghetto sage', 'exclude', 'person_or_label', null, null),
  ('poland', 'exclude', 'place', null, null),
  ('brazil', 'exclude', 'place', null, null),
  ('miguel', 'exclude', 'person_or_label', null, null),
  ('happy trap', 'exclude', 'junk', null, 'Single artist.'),
  ('hard trance', 'include', 'style', 'hard trance', null),
  ('alte', 'include', 'style', 'alte', null),
  ('brutal death metal', 'include', 'style', 'brutal death metal', null),
  ('kpop', 'include', 'style', 'k-pop', null),
  ('ost', 'include', 'texture', 'soundtrack', null),
  ('ariana grande', 'exclude', 'person_or_label', null, null),
  ('belgian', 'exclude', 'place', null, null),
  ('underground', 'exclude', 'junk', null, 'Scene descriptor, no sound meaning.'),
  ('driving', 'exclude', 'junk', null, 'Single artist; would make one act the whole label.'),
  ('melodic rap', 'include', 'style', 'melodic rap', null),
  ('footwork', 'include', 'style', 'footwork', null),
  ('funk add to lidarr', 'exclude', 'junk', null, null),
  ('funk add to lidarr batch 30', 'exclude', 'junk', null, null),
  ('norway', 'exclude', 'place', null, null),
  ('4', 'exclude', 'junk', null, null),
  ('aarhus', 'exclude', 'place', null, null),
  ('bookmarks', 'exclude', 'junk', null, null),
  ('coldplay', 'exclude', 'person_or_label', null, null),
  ('no wave', 'include', 'style', 'no wave', null),
  ('field recordings', 'include', 'texture', 'field recordings', 'One listener only.'),
  ('jpop', 'include', 'style', 'j-pop', null),
  ('katy perry', 'exclude', 'person_or_label', null, null),
  ('psy prog', 'include', 'style', 'progressive psytrance', 'One listener only.'),
  ('relaxation', 'include', 'mood', 'relaxing', 'One listener only.'),
  ('uplifting trance', 'include', 'style', 'uplifting trance', null),
  ('baroque pop', 'include', 'style', 'baroque pop', 'One listener only.'),
  ('christian hip hop', 'include', 'style', 'christian hip hop', 'One listener only.'),
  ('80s influenced', 'exclude', 'era', null, null),
  ('collective', 'exclude', 'junk', null, null),
  ('grunge', 'include', 'style', 'grunge', null),
  ('vocal', 'exclude', 'junk', null, 'Ambiguous (vocal trance / vocal jazz / vocalist).'),
  ('russian', 'exclude', 'place', null, null),
  ('g funk', 'include', 'style', 'g funk', null),
  ('game', 'exclude', 'junk', null, null),
  ('jizz jazz', 'exclude', 'junk', null, 'Joke genre on one artist.'),
  ('justin bieber', 'exclude', 'person_or_label', null, null),
  ('ethereal', 'include', 'mood', 'ethereal', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('lofi hip hop', 'include', 'texture', 'lo-fi', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('sleep', 'include', 'mood', 'sleep', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('synth', 'include', 'texture', 'synth', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('funny', 'include', 'mood', 'funny', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('hardcore rap', 'include', 'style', 'hardcore hip-hop', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('guitar', 'include', 'texture', 'guitar', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('male vocalist', 'include', 'texture', 'male vocalists', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('emotional', 'include', 'mood', 'emotional', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('melancholic', 'include', 'mood', 'melancholic', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('field recording', 'include', 'texture', 'field recordings', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('rain sound', 'include', 'texture', 'rain sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('soundscape', 'include', 'texture', 'soundscape', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('video game soundtrack', 'exclude', 'junk', null, 'Two artists; kept out rather than merged. Below top-520 by coverage; added as mood/texture or synonym.'),
  ('rain sounds', 'include', 'texture', 'rain sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('groovy', 'include', 'mood', 'groovy', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('nature healing', 'include', 'texture', 'nature sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('white noise', 'include', 'texture', 'white noise', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('nature music', 'include', 'texture', 'nature sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('funky', 'include', 'mood', 'groovy', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('dream', 'include', 'mood', 'dreamy', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('meditation', 'include', 'mood', 'meditation', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('lofihiphop', 'include', 'texture', 'lo-fi', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('slowcore', 'include', 'style', 'slowcore', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('game soundtrack', 'include', 'texture', 'video game music', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('sound of nature', 'include', 'texture', 'nature sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('smooth', 'include', 'mood', 'smooth', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('sadcore', 'include', 'style', 'sadcore', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('soundtracks', 'include', 'texture', 'soundtrack', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('water sounds', 'include', 'texture', 'nature sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('water sound', 'include', 'texture', 'nature sounds', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('lo fi hiphop', 'include', 'texture', 'lo-fi', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('dreampop', 'include', 'style', 'dream pop', 'Below top-520 by coverage; added as mood/texture or synonym.'),
  ('mellow', 'include', 'mood', 'mellow', 'Below top-520 by coverage; added as mood/texture or synonym.')
on conflict (normalized_tag) do nothing;

-- 2. The payload.
create or replace function public.build_insights_payload(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  result jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  with plays as (
    select
      e.local_date,
      e.track_id,
      e.primary_artist_id as artist_id,
      extract(hour from (e.played_at at time zone 'Australia/Melbourne'))::int as hour
    from listening_events e
    where e.user_id = p_user_id
      and e.archived_at is null
  ),
  -- Latest Last.fm listener count per artist. Artist stats are almost all
  -- name-matched, so they are trusted as they are.
  artist_listeners as (
    select distinct on (s.artist_id) s.artist_id, s.listeners, s.observed_on
    from external_music_stats s
    where s.source = 'lastfm'
      and s.artist_id is not null
      and s.listeners is not null
    order by s.artist_id, s.observed_on desc
  ),
  -- Popularity: a play-weighted median of artist listeners per bucket.
  -- Aggregating to (bucket, artist) first is ~10x faster than ordering every
  -- play, and gives the same median.
  bucket_artist as (
    select 'all_time'::text as bucket, artist_id, count(*)::bigint as plays
    from plays group by artist_id
    union all
    select 'last_30_days', artist_id, count(*)
    from plays where local_date >= melbourne_today - 29 group by artist_id
    union all
    select extract(year from local_date)::int::text, artist_id, count(*)
    from plays group by 1, artist_id
  ),
  bucket_totals as (
    select bucket, sum(plays)::int as plays
    from bucket_artist
    group by bucket
  ),
  covered as (
    select
      ba.bucket,
      al.listeners,
      sum(ba.plays) over (
        partition by ba.bucket order by al.listeners, ba.artist_id
        rows unbounded preceding
      ) as running_plays,
      sum(ba.plays) over (partition by ba.bucket) as covered_plays
    from bucket_artist ba
    join artist_listeners al using (artist_id)
  ),
  medians as (
    select distinct on (bucket) bucket, listeners as median_artist_listeners, covered_plays::int
    from covered
    where running_plays * 2 >= covered_plays
    order by bucket, running_plays
  ),
  popularity as (
    select
      t.bucket,
      jsonb_build_object(
        'median_artist_listeners', m.median_artist_listeners,
        'plays', t.plays,
        'covered_plays', coalesce(m.covered_plays, 0)
      ) as summary
    from bucket_totals t
    left join medians m using (bucket)
  ),
  -- Deep cuts use name-matched track stats only: MBID matches often land on a
  -- near-empty duplicate Last.fm entry (featured tracks especially).
  track_listeners as (
    select distinct on (s.track_id) s.track_id, s.listeners
    from external_music_stats s
    join external_music_metadata m
      on m.track_id = s.track_id
     and m.source = 'lastfm'
     and m.match_method = 'name'
    where s.source = 'lastfm'
      and s.track_id is not null
      and s.listeners is not null
    order by s.track_id, s.observed_on desc
  ),
  -- The artist comes from the plays, not track_artists: some tracks carry two
  -- order-0 artist rows (duplicate artist records), which would list them twice.
  track_plays as (
    select p.track_id, min(p.artist_id) as artist_id, count(*)::int as plays
    from plays p
    group by p.track_id
  ),
  -- One song is often several Spotify tracks (single, album, remaster), so
  -- merge by artist and lower-cased name.
  deep_cuts as (
    select
      tp.artist_id,
      (array_agg(t.name order by tp.plays desc, t.id))[1] as track_name,
      (array_agg(t.spotify_track_id order by tp.plays desc, t.id))[1] as spotify_track_id,
      sum(tp.plays)::int as plays,
      max(tl.listeners) as track_listeners
    from track_plays tp
    join track_listeners tl using (track_id)
    join tracks t on t.id = tp.track_id
    group by tp.artist_id, lower(t.name)
    -- Filter after merging, so a song counts all its versions' plays and any
    -- version at 20k+ listeners keeps it off the list.
    having sum(tp.plays) >= 3
       and max(tl.listeners) < 20000
    order by sum(tp.plays) desc, max(tl.listeners), tp.artist_id, lower(t.name)
    limit 10
  ),
  -- Hour tags: which labels this person plays more than their own average in
  -- each part of the day. Each play counts at most once per label.
  parts(part, ord, first_hour, last_hour) as (
    values
      ('late_night', 1, 0, 4),
      ('morning', 2, 5, 8),
      ('day', 3, 9, 16),
      ('evening', 4, 17, 20),
      ('night', 5, 21, 23)
  ),
  part_artist as (
    select pt.part, p.artist_id, count(*)::numeric as plays
    from plays p
    join parts pt on p.hour between pt.first_hour and pt.last_hour
    group by pt.part, p.artist_id
  ),
  part_totals as (
    select part, sum(plays) as plays from part_artist group by part
  ),
  grand_total as (
    select sum(plays) as plays from part_totals
  ),
  artist_labels as (
    select distinct t.artist_id, r.label
    from external_music_tags t
    join clock_tag_rules r
      on r.normalized_tag = t.normalized_tag
     and r.decision = 'include'
    where t.source = 'lastfm'
      and t.artist_id is not null
      and t.rank <= 10
      and t.artist_id in (select artist_id from part_artist)
  ),
  label_part as (
    select
      pa.part,
      al.label,
      sum(pa.plays) as n,
      count(*) as artists,
      max(pa.plays) as top_artist_plays
    from part_artist pa
    join artist_labels al using (artist_id)
    group by pa.part, al.label
  ),
  label_totals as (
    select label, sum(n) as n from label_part group by label
  ),
  -- Adjusted lift pulls small counts toward 1. The artist rules matter most:
  -- without them a single artist becomes a whole label ("smooth jazz 9.15x").
  scored as (
    select
      lp.part,
      lp.label,
      lp.n,
      (lp.n + 20) / (pt.plays * lt.n / gt.plays + 20) as lift
    from label_part lp
    join part_totals pt using (part)
    join label_totals lt using (label)
    cross join grand_total gt
    where pt.plays >= 150
      and lp.n >= 15
      and lp.artists >= 3
      and lp.top_artist_plays * 2 <= lp.n
  ),
  ranked as (
    select s.*, row_number() over (partition by part order by lift desc, n desc, label) as rn
    from scored s
    where lift >= 1.15
  )
  select jsonb_build_object(
    'generated_at', now(),
    'timezone', 'Australia/Melbourne',
    'source', 'lastfm',
    -- The newest Last.fm day behind this person's numbers, not the newest
    -- observation in the whole table.
    'stats_observed_through', (
      select max(al.observed_on)
      from artist_listeners al
      where al.artist_id in (select artist_id from bucket_artist)
    ),
    'popularity', jsonb_build_object(
      'all_time', (select summary from popularity where bucket = 'all_time'),
      'last_30_days', (select summary from popularity where bucket = 'last_30_days'),
      'by_year', coalesce((
        select jsonb_agg(
          jsonb_build_object('year', bucket::int) || summary
          order by bucket::int
        )
        from popularity
        where bucket ~ '^[0-9]{4}$'
      ), '[]'::jsonb),
      'deep_cuts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'spotify_track_id', dc.spotify_track_id,
          'track_name', dc.track_name,
          'artist_id', dc.artist_id,
          'artist_name', a.name,
          'plays', dc.plays,
          'track_listeners', dc.track_listeners
        ) order by dc.plays desc, dc.track_listeners, dc.artist_id, dc.track_name)
        from deep_cuts dc
        left join artists a on a.id = dc.artist_id
      ), '[]'::jsonb)
    ),
    'hour_tags', (
      select jsonb_agg(jsonb_build_object(
        'part', pt.part,
        'first_hour', pt.first_hour,
        'last_hour', pt.last_hour,
        'plays', coalesce(tot.plays, 0)::int,
        'labels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label', r.label,
            'plays', r.n::int,
            'lift', round(r.lift, 2)
          ) order by r.rn)
          from ranked r
          where r.part = pt.part and r.rn <= 3
        ), '[]'::jsonb)
      ) order by pt.ord)
      from parts pt
      left join part_totals tot using (part)
    )
  )
  into result;

  return result;
end;
$$;

-- 3. Refresh one user. Its own advisory lock, so it never waits on the
--    sync/drain lock taken by refresh_user_public_stats.
create or replace function public.refresh_user_insights_cache(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refresh_user_insights_cache:' || p_user_id::text, 0)
  );

  payload := public.build_insights_payload(p_user_id);

  insert into overview_cache (key, user_id, payload, generated_at)
  values ('public_insights:' || p_user_id::text, p_user_id, payload, now())
  on conflict (key) do update
    set user_id = excluded.user_id,
        payload = excluded.payload,
        generated_at = excluded.generated_at;
end;
$$;

-- 4. Refresh everyone. Called by the daily cron job.
create or replace function public.refresh_all_insights_caches()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  profile_record record;
  refreshed integer := 0;
begin
  for profile_record in select user_id from profiles loop
    -- One user's failure (most likely a statement timeout) must not leave
    -- everyone else's cache stale. The block rolls back only this user's
    -- refresh; the warning lands in the Postgres log.
    begin
      perform public.refresh_user_insights_cache(profile_record.user_id);
      refreshed := refreshed + 1;
    exception when others then
      raise warning 'refresh_user_insights_cache(%) failed: %', profile_record.user_id, sqlerrm;
    end;
  end loop;
  return refreshed;
end;
$$;

revoke all on function public.build_insights_payload(uuid) from public, anon, authenticated;
revoke all on function public.refresh_user_insights_cache(uuid) from public, anon, authenticated;
revoke all on function public.refresh_all_insights_caches() from public, anon, authenticated;
grant execute on function public.build_insights_payload(uuid) to service_role;
grant execute on function public.refresh_user_insights_cache(uuid) to service_role;
grant execute on function public.refresh_all_insights_caches() to service_role;

-- 5. Public read path. Same shape and gate as public_profile_overview; the
--    existing overview_cache RLS policy (owner, or public and not archived)
--    already covers the new key.
create or replace view public.public_profile_insights
with (security_invoker = true)
as
select
  p.user_id,
  p.slug,
  p.display_name,
  oc.payload,
  oc.generated_at
from profiles p
join overview_cache oc on oc.user_id = p.user_id
where p.is_public = true
  and oc.archived_at is null
  and oc.key = 'public_insights:' || p.user_id::text;

grant select on table public.public_profile_insights to anon, authenticated;

-- 6. Daily at 17:37 UTC (03:37 or 04:37 in Melbourne), after the overnight
--    enrichment batches and away from the :00/:15/:30/:45 sync slots.
select cron.schedule(
  'refresh-insights-caches',
  '37 17 * * *',
  $$ select public.refresh_all_insights_caches(); $$
);

-- 7. Build every cache once so the pages have data immediately.
select public.refresh_all_insights_caches();

notify pgrst, 'reload schema';
