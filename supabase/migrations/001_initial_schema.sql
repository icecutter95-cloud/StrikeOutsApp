-- StrikeOuts App Initial Schema
-- Run this in your Supabase SQL editor or via migrations

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- predictions
-- ============================================================
CREATE TABLE IF NOT EXISTS predictions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Game info
  game_date                  DATE NOT NULL,
  pitcher_name               TEXT NOT NULL,
  pitcher_id                 TEXT NOT NULL,
  team                       TEXT NOT NULL,
  opponent                   TEXT NOT NULL,
  venue                      TEXT NOT NULL,
  game_time                  TIMESTAMPTZ,
  pitcher_hand               TEXT CHECK (pitcher_hand IN ('R', 'L')),

  -- Model outputs
  projected_ks               DECIMAL(4,2),
  confidence_low             DECIMAL(4,2),
  confidence_high            DECIMAL(4,2),

  -- Input components
  last3_k_rate               DECIMAL(5,4),
  season_k_pct               DECIMAL(5,4),
  csw_pct                    DECIMAL(5,4),
  xfip_k_rate                DECIMAL(5,4),
  model_weights              JSONB DEFAULT '{"last3":0.35,"season":0.30,"csw":0.20,"xfip":0.15}',

  -- Lineup
  lineup_confirmation_status TEXT CHECK (lineup_confirmation_status IN ('confirmed', 'partial', 'unconfirmed')),
  lineup_k_vulnerability     DECIMAL(5,4),

  -- Odds / line
  prop_line                  DECIMAL(4,2),
  prop_odds_over             INTEGER,
  prop_odds_under            INTEGER,
  opening_line               DECIMAL(4,2),

  -- Edge / recommendation
  edge_pct                   DECIMAL(6,4),
  model_prob_over            DECIMAL(5,4),
  model_prob_under           DECIMAL(5,4),
  book_implied_over          DECIMAL(5,4),
  book_implied_under         DECIMAL(5,4),
  recommendation             TEXT CHECK (recommendation IN ('BET_OVER', 'BET_UNDER', 'NO_BET')),
  recommended_units          DECIMAL(3,1),

  -- Steam
  steam_flag                 BOOLEAN DEFAULT FALSE,
  steam_direction            TEXT,

  -- Contextual modifiers
  projected_ip               DECIMAL(3,1),
  park_factor                DECIMAL(5,4) DEFAULT 1.0,
  weather_modifier           DECIMAL(5,4) DEFAULT 1.0,

  -- Actuals (filled post-game)
  actual_ks                  INTEGER,
  actual_ip                  DECIMAL(3,1),
  actual_pitch_count         INTEGER,
  closing_line               DECIMAL(4,2),
  model_correct              BOOLEAN,
  clv                        DECIMAL(5,4),

  -- Game state
  game_status                TEXT DEFAULT 'scheduled' CHECK (game_status IN ('scheduled', 'in_progress', 'final')),

  -- User tracking
  user_bet_placed            BOOLEAN,
  user_bet_side              TEXT,
  user_bet_units             DECIMAL(3,1),
  user_bet_book              TEXT,
  bet_result                 TEXT CHECK (bet_result IN ('win', 'loss', 'push'))
);

-- ============================================================
-- line_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS line_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  pitcher_id    TEXT NOT NULL,
  game_date     DATE NOT NULL,
  line          DECIMAL(4,2) NOT NULL,
  odds_over     INTEGER,
  odds_under    INTEGER,
  book_key      TEXT
);

-- ============================================================
-- pitcher_stats_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS pitcher_stats_cache (
  pitcher_id              TEXT PRIMARY KEY,
  pitcher_name            TEXT NOT NULL,
  team                    TEXT,
  hand                    TEXT,
  season_k_pct            DECIMAL(5,4),
  season_k9               DECIMAL(5,2),
  csw_pct                 DECIMAL(5,4),
  swstr_pct               DECIMAL(5,4),
  xfip                    DECIMAL(4,2),
  last3_k_rate            DECIMAL(5,4),
  last3_ip                DECIMAL(4,1),
  avg_pitches_per_start   DECIMAL(5,1),
  last_start_pitches      INTEGER,
  last_start_ip           DECIMAL(3,1),
  pitch_mix               JSONB,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- batter_stats_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS batter_stats_cache (
  batter_id      TEXT PRIMARY KEY,
  batter_name    TEXT NOT NULL,
  team           TEXT,
  hand           TEXT,
  k_pct_vs_rhp   DECIMAL(5,4),
  k_pct_vs_lhp   DECIMAL(5,4),
  swstr_pct      DECIMAL(5,4),
  chase_rate     DECIMAL(5,4),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- model_config (single-row config)
-- ============================================================
CREATE TABLE IF NOT EXISTS model_config (
  id                          INTEGER PRIMARY KEY DEFAULT 1,
  weight_last3                DECIMAL(4,3) DEFAULT 0.35,
  weight_season               DECIMAL(4,3) DEFAULT 0.30,
  weight_csw                  DECIMAL(4,3) DEFAULT 0.20,
  weight_xfip                 DECIMAL(4,3) DEFAULT 0.15,
  edge_tier1_min              DECIMAL(4,3) DEFAULT 0.04,
  edge_tier1_units            DECIMAL(3,1) DEFAULT 1.0,
  edge_tier2_min              DECIMAL(4,3) DEFAULT 0.07,
  edge_tier2_units            DECIMAL(3,1) DEFAULT 1.5,
  edge_tier3_min              DECIMAL(4,3) DEFAULT 0.10,
  edge_tier3_units            DECIMAL(3,1) DEFAULT 2.0,
  unconfirmed_lineup_penalty  DECIMAL(4,3) DEFAULT 0.02,
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_predictions_game_date  ON predictions (game_date);
CREATE INDEX IF NOT EXISTS idx_predictions_pitcher_id ON predictions (pitcher_id);
CREATE INDEX IF NOT EXISTS idx_line_snapshots_prediction_id ON line_snapshots (prediction_id);
CREATE INDEX IF NOT EXISTS idx_line_snapshots_game_date     ON line_snapshots (game_date);

-- ============================================================
-- Default model_config row
-- ============================================================
INSERT INTO model_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
