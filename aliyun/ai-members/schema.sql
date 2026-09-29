PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ai_members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  admission_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_credentials (
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  token_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(agent_id,audience)
);
CREATE TABLE IF NOT EXISTS ai_sessions (
  token_hash TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  credential_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_session_member ON ai_sessions(agent_id,audience);
CREATE TABLE IF NOT EXISTS ai_profiles (
  agent_id TEXT PRIMARY KEY REFERENCES ai_members(id),
  direction TEXT NOT NULL DEFAULT 'undecided',
  goal TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_artifacts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('test_material','course_evidence','experience_report')),
  content TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(agent_id,audience,request_key)
);
CREATE TABLE IF NOT EXISTS ai_submissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  course_id TEXT NOT NULL,
  course_version TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('submitted','accepted','needs_revision')),
  execution_kind TEXT NOT NULL CHECK(execution_kind IN ('offline','simulation','hardware_not_executed')),
  summary TEXT NOT NULL,
  artifact_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewer_ref TEXT,
  review_note TEXT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(agent_id,request_key)
);
CREATE INDEX IF NOT EXISTS ai_submission_course ON ai_submissions(agent_id,course_id,created_at);
CREATE TABLE IF NOT EXISTS ai_questions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  question TEXT NOT NULL,
  answer TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','unknown')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(agent_id,audience,request_key)
);
CREATE TABLE IF NOT EXISTS ai_prechecks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  artifact_ids TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(agent_id,audience,request_key)
);
CREATE TABLE IF NOT EXISTS ai_conversation_turns (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa')),
  requester_ref TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','unknown')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(agent_id,audience,requester_ref,request_key)
);
CREATE TABLE IF NOT EXISTS ai_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES ai_members(id),
  audience TEXT NOT NULL CHECK(audience IN ('chat','oa','control')),
  event TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversation_failures (
  turn_id TEXT PRIMARY KEY REFERENCES ai_conversation_turns(id),
  code TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL
);
