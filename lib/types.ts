// ============================================================
// Database row types
// ============================================================

export interface Prediction {
  id: string;
  created_at: string;

  // Game info
  game_date: string;
  pitcher_name: string;
  pitcher_id: string;
  team: string;
  opponent: string;
  venue: string;
  game_time: string | null;
  pitcher_hand: "R" | "L" | null;

  // Model outputs
  projected_ks: number | null;
  confidence_low: number | null;
  confidence_high: number | null;

  // Input components
  last3_k_rate: number | null;
  season_k_pct: number | null;
  csw_pct: number | null;
  xfip_k_rate: number | null;
  model_weights: {
    last3: number;
    season: number;
    csw: number;
    xfip: number;
  } | null;

  // Lineup
  lineup_confirmation_status: "confirmed" | "partial" | "unconfirmed" | null;
  lineup_k_vulnerability: number | null;
  lineup_data: LineupPlayer[] | null;

  // Odds / line
  prop_line: number | null;
  prop_odds_over: number | null;
  prop_odds_under: number | null;
  opening_line: number | null;

  // Edge / recommendation
  edge_pct: number | null;
  model_prob_over: number | null;
  model_prob_under: number | null;
  book_implied_over: number | null;
  book_implied_under: number | null;
  recommendation: "BET_OVER" | "BET_UNDER" | "NO_BET" | null;
  recommended_units: number | null;

  // Steam
  steam_flag: boolean;
  steam_direction: string | null;

  // Contextual modifiers
  projected_ip: number | null;
  park_factor: number;
  weather_modifier: number;

  // Actuals (post-game)
  actual_ks: number | null;
  actual_ip: number | null;
  actual_pitch_count: number | null;
  closing_line: number | null;
  model_correct: boolean | null;
  clv: number | null;

  // Game state
  game_status: "scheduled" | "in_progress" | "final";

  // User tracking
  user_bet_placed: boolean | null;
  user_bet_side: string | null;
  user_bet_units: number | null;
  user_bet_book: string | null;
  bet_result: "win" | "loss" | "push" | null;
}

export interface LineSnapshot {
  id: string;
  created_at: string;
  prediction_id: string | null;
  pitcher_id: string;
  game_date: string;
  line: number;
  odds_over: number | null;
  odds_under: number | null;
  book_key: string | null;
}

export interface PitcherStats {
  pitcher_id: string;
  pitcher_name: string;
  team: string | null;
  hand: string | null;
  season_k_pct: number | null;
  season_k9: number | null;
  csw_pct: number | null;
  swstr_pct: number | null;
  xfip: number | null;
  last3_k_rate: number | null;
  last3_ip: number | null;
  avg_pitches_per_start: number | null;
  last_start_pitches: number | null;
  last_start_ip: number | null;
  pitch_mix: Record<string, number> | null;
  updated_at: string;
}

export interface BatterStats {
  batter_id: string;
  batter_name: string;
  team: string | null;
  hand: string | null;
  k_pct_vs_rhp: number | null;
  k_pct_vs_lhp: number | null;
  swstr_pct: number | null;
  chase_rate: number | null;
  updated_at: string;
}

export interface ModelConfig {
  id: number;
  weight_last3: number;
  weight_season: number;
  weight_csw: number;
  weight_xfip: number;
  edge_tier1_min: number;
  edge_tier1_units: number;
  edge_tier2_min: number;
  edge_tier2_units: number;
  edge_tier3_min: number;
  edge_tier3_units: number;
  unconfirmed_lineup_penalty: number;
  updated_at: string;
}

// ============================================================
// Derived / computation types
// ============================================================

export interface ProjectionResult {
  projected_ks: number;
  confidence_low: number;
  confidence_high: number;
  model_prob_over: number;
  model_prob_under: number;
  edge_pct: number;
  recommendation: "BET_OVER" | "BET_UNDER" | "NO_BET";
  recommended_units: number;
  projected_ip: number;
  steam_flag: boolean;
  lineup_confirmation_status: "confirmed" | "partial" | "unconfirmed";
  lineup_k_vulnerability: number;
  park_factor: number;
  weather_modifier: number;
  book_implied_over: number | null;
  book_implied_under: number | null;
}

export interface GameInfo {
  pitcher_id: string;
  pitcher_name: string;
  team: string;
  team_id: number;
  opponent: string;
  opponent_id: number;
  opponent_side: "home" | "away"; // which side of the game the opponent bats from
  venue: string;
  game_time: string;
  pitcher_hand: "R" | "L" | null;
  game_id: number;
}

export interface LineupPlayer {
  batter_id: string;
  batter_name: string;
  hand: "R" | "L" | "S" | null;
  batting_order: number;
  k_pct_vs_rhp: number | null;
  k_pct_vs_lhp: number | null;
}

// ============================================================
// API / external types
// ============================================================

export interface OddsProp {
  pitcher_id: string;
  pitcher_name: string;
  line: number;
  odds_over: number;
  odds_under: number;
  book_key: string;
  event_id: string;
}

export interface GameResult {
  actualKs: number;
  actualIp: number;
  actualPitches: number;
}
