CREATE TABLE monitor_farms (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 record TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 archived INTEGER NOT NULL DEFAULT 0,
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX monitor_farm_owner ON monitor_farms(user_id,archived);
--> statement-breakpoint
CREATE TABLE monitor_observations (
 id TEXT PRIMARY KEY NOT NULL,
 farm_id TEXT NOT NULL REFERENCES monitor_farms(id),
 record TEXT NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX monitor_observation_farm ON monitor_observations(farm_id,created);
--> statement-breakpoint
CREATE TABLE monitor_guidance (
 id TEXT PRIMARY KEY NOT NULL,
 farm_id TEXT NOT NULL REFERENCES monitor_farms(id),
 language TEXT NOT NULL,
 record TEXT NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX monitor_guidance_farm ON monitor_guidance(farm_id,created);
