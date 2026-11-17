-- Sketch Studio analytics (TASK 738): the D1 schema (database sketch_analytics, bound as env.DB).
--   rollups: one row per (day, event type): that day's usage counts, folded nightly by scheduled() (and by POST /rollup for a backfill).
-- Apply:  npx wrangler d1 execute sketch_analytics --remote --file=migrations/0001_rollups.sql
-- PRIMARY KEY (date, event) makes a day's rows unique; the rollup DELETEs the range and re-INSERTs it, so a re-run REPLACES the totals (never doubles).
-- The dev split is kept: real users = count - devCount; the owner's own = devCount.
CREATE TABLE IF NOT EXISTS rollups (
  date      TEXT NOT NULL,               -- YYYY-MM-DD (UTC)
  event     TEXT NOT NULL,               -- blob1: visit | feature
  count     INTEGER NOT NULL,            -- the estimated TOTAL (SUM(_sample_interval), all traffic)
  devCount  INTEGER NOT NULL DEFAULT 0,  -- the owner's portion of count (blob9 = '1')
  PRIMARY KEY (date, event)
);
