CREATE TABLE IF NOT EXISTS visitor_accounts (
  email TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','staff')),
  registered_at INTEGER NOT NULL,
  last_login_at INTEGER,
  registration_source TEXT NOT NULL CHECK (registration_source IN ('observed','inferred'))
);

-- Historic registration time was not retained. Preserve the earliest known
-- activity as inferred; expired sessions are not a reliable user directory.
INSERT OR IGNORE INTO visitor_accounts(email,role,registered_at,last_login_at,registration_source)
SELECT lower(email),
  CASE WHEN lower(email) LIKE '%@stumail.sztu.edu.cn' THEN 'student' ELSE 'staff' END,
  MIN(known_at), MAX(login_at), 'inferred'
FROM (
  SELECT email, created_at AS known_at, NULL AS login_at FROM newbie_profiles
  UNION ALL
  SELECT email, accepted_at AS known_at, NULL AS login_at FROM newbie_agreement_acceptances
  UNION ALL
  SELECT email, updated_at AS known_at, NULL AS login_at FROM newbie_task_progress
  UNION ALL
  SELECT email, created_at AS known_at, created_at AS login_at FROM visitor_sessions
    WHERE expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000
) GROUP BY lower(email);

CREATE TABLE IF NOT EXISTS newbie_questions (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  course_id TEXT NOT NULL,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 12000),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_newbie_questions_time ON newbie_questions(created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_newbie_questions_email_time ON newbie_questions(email,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newbie_questions_course_time ON newbie_questions(course_id,created_at DESC);
INSERT OR IGNORE INTO settings(id,value)
VALUES('newbie_question_tracking_started_at', CAST(CAST(strftime('%s','now') AS INTEGER) * 1000 AS TEXT));

-- Alibaba runtime migration tracker.
INSERT INTO d1_migrations(name) SELECT '0008_newbie_admin.sql' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0008_newbie_admin.sql');
