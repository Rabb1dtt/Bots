const { Pool } = require('pg');

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
}

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL,
      locale TEXT,
      timezone TEXT,
      subscription_tier TEXT DEFAULT 'free',
      subscription_status TEXT DEFAULT 'active',
      subscription_expires_at TIMESTAMPTZ,
      ai_token_budget_monthly INTEGER DEFAULT 0,
      ai_token_used_monthly INTEGER DEFAULT 0,
      ai_token_reset_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sessions (
      user_id TEXT PRIMARY KEY,
      state TEXT,
      data_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS careers (
      career_id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      profile_json JSONB,
      current_club_json JSONB,
      previous_clubs_json JSONB,
      trophies_json JSONB,
      coach_style_json JSONB,
      reputation INTEGER,
      board_trust INTEGER,
      board_model_json JSONB,
      goals_json JSONB,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history_events (
      event_id SERIAL PRIMARY KEY,
      career_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seasons (
      season_id SERIAL PRIMARY KEY,
      career_id INTEGER NOT NULL,
      season_start_date DATE NOT NULL,
      fifa_transfer_budget INTEGER,
      approved_transfer_budget INTEGER,
      salary_status TEXT,
      coach_limit INTEGER,
      youth_scouting_package TEXT,
      coach_rating INTEGER,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS season_snapshots (
      snapshot_id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL,
      squad_snapshot_json JSONB,
      coach_staff_plan_json JSONB,
      youth_scouting_plan_json JSONB,
      season_objectives_json JSONB,
      transfer_rules_json JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
}

async function createStorage(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  await createTables(pool);

  async function touchUser(userId, options = {}) {
    const payload = {
      user_id: String(userId),
      created_at: new Date(),
      last_seen: new Date(),
      subscription_tier: options.subscriptionTier || 'free',
      subscription_status: options.subscriptionStatus || 'active'
    };
    await pool.query(
      `
        INSERT INTO users (user_id, created_at, last_seen, subscription_tier, subscription_status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
          last_seen = EXCLUDED.last_seen,
          subscription_tier = COALESCE(EXCLUDED.subscription_tier, users.subscription_tier),
          subscription_status = COALESCE(EXCLUDED.subscription_status, users.subscription_status)
      `,
      [
        payload.user_id,
        payload.created_at,
        payload.last_seen,
        payload.subscription_tier,
        payload.subscription_status
      ]
    );
  }

  async function saveSession(userId, state, data) {
    const payload = {
      user_id: String(userId),
      state,
      data_json: data || {},
      updated_at: new Date()
    };
    await pool.query(
      `
        INSERT INTO sessions (user_id, state, data_json, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
          state = EXCLUDED.state,
          data_json = EXCLUDED.data_json,
          updated_at = EXCLUDED.updated_at
      `,
      [payload.user_id, payload.state, payload.data_json, payload.updated_at]
    );
  }

  async function loadSession(userId) {
    const result = await pool.query(
      'SELECT state, data_json FROM sessions WHERE user_id = $1',
      [String(userId)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      state: row.state,
      data: parseJsonValue(row.data_json, {})
    };
  }

  async function getActiveCareer(userId) {
    const result = await pool.query(
      `
        SELECT * FROM careers
        WHERE user_id = $1 AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [String(userId)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      profile: parseJsonValue(row.profile_json, {}),
      currentClub: parseJsonValue(row.current_club_json, null),
      previousClubs: parseJsonValue(row.previous_clubs_json, []),
      trophies: parseJsonValue(row.trophies_json, []),
      coachStyle: parseJsonValue(row.coach_style_json, {}),
      boardModel: parseJsonValue(row.board_model_json, {}),
      goals: parseJsonValue(row.goals_json, {})
    };
  }

  async function upsertCareerSnapshot(userId, snapshot) {
    const existing = await getActiveCareer(userId);
    const now = new Date();
    if (!existing) {
      const result = await pool.query(
        `
          INSERT INTO careers (
            user_id, is_active, profile_json, current_club_json, previous_clubs_json, trophies_json,
            coach_style_json, reputation, board_trust, board_model_json, goals_json, created_at, updated_at
          )
          VALUES ($1, TRUE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING career_id
        `,
        [
          String(userId),
          snapshot.profile || {},
          snapshot.currentClub || null,
          snapshot.previousClubs || [],
          snapshot.trophies || [],
          snapshot.coachStyle || {},
          snapshot.reputation ?? null,
          snapshot.boardTrust ?? null,
          snapshot.boardModel || {},
          snapshot.goals || {},
          now,
          now
        ]
      );
      return result.rows[0];
    }

    const payload = {
      profile: snapshot.profile || existing.profile,
      currentClub: snapshot.currentClub ?? existing.currentClub,
      previousClubs: snapshot.previousClubs ?? existing.previousClubs,
      trophies: snapshot.trophies ?? existing.trophies,
      coachStyle: snapshot.coachStyle ?? existing.coachStyle,
      reputation: snapshot.reputation ?? existing.reputation ?? null,
      boardTrust: snapshot.boardTrust ?? existing.board_trust ?? null,
      boardModel: snapshot.boardModel ?? existing.boardModel,
      goals: snapshot.goals ?? existing.goals
    };

    await pool.query(
      `
        UPDATE careers SET
          profile_json = $1,
          current_club_json = $2,
          previous_clubs_json = $3,
          trophies_json = $4,
          coach_style_json = $5,
          reputation = $6,
          board_trust = $7,
          board_model_json = $8,
          goals_json = $9,
          updated_at = $10
        WHERE career_id = $11
      `,
      [
        payload.profile,
        payload.currentClub,
        payload.previousClubs,
        payload.trophies,
        payload.coachStyle,
        payload.reputation,
        payload.boardTrust,
        payload.boardModel,
        payload.goals,
        now,
        existing.career_id
      ]
    );

    return { career_id: existing.career_id };
  }

  async function addHistoryEvent(careerId, eventType, payload) {
    await pool.query(
      `
        INSERT INTO history_events (career_id, event_type, payload_json, created_at)
        VALUES ($1, $2, $3, $4)
      `,
      [careerId, eventType, payload || {}, new Date()]
    );
  }

  async function createSeason(careerId, season, snapshot) {
    const now = new Date();
    const seasonResult = await pool.query(
      `
        INSERT INTO seasons (
          career_id, season_start_date, fifa_transfer_budget, approved_transfer_budget, salary_status,
          coach_limit, youth_scouting_package, coach_rating, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING season_id
      `,
      [
        careerId,
        season.seasonStartDate,
        season.fifaTransferBudget ?? null,
        season.approvedTransferBudget ?? null,
        season.salaryStatus ?? null,
        season.coachLimit ?? null,
        season.youthScoutingPackage ?? null,
        season.coachRating ?? null,
        now,
        now
      ]
    );
    const seasonId = seasonResult.rows[0].season_id;
    await pool.query(
      `
        INSERT INTO season_snapshots (
          season_id, squad_snapshot_json, coach_staff_plan_json, youth_scouting_plan_json,
          season_objectives_json, transfer_rules_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        seasonId,
        snapshot.squadSnapshot || {},
        snapshot.coachStaffPlan || {},
        snapshot.youthScoutingPlan || {},
        snapshot.seasonObjectives || [],
        snapshot.transferRules || {},
        now
      ]
    );
    return seasonId;
  }

  async function addTokenUsage(userId, tokens) {
    await pool.query(
      `
        UPDATE users
        SET ai_token_used_monthly = COALESCE(ai_token_used_monthly, 0) + $1
        WHERE user_id = $2
      `,
      [tokens || 0, String(userId)]
    );
  }

  return {
    touchUser,
    saveSession,
    loadSession,
    upsertCareerSnapshot,
    addHistoryEvent,
    createSeason,
    addTokenUsage,
    getActiveCareer
  };
}

module.exports = {
  createStorage
};
