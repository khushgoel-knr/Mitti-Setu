ALTER TABLE crops ADD COLUMN quality INTEGER CHECK(quality IS NULL OR (quality BETWEEN 0 AND 100));
--> statement-breakpoint
ALTER TABLE crops ADD COLUMN quality_source TEXT NOT NULL DEFAULT 'not_provided';
--> statement-breakpoint
ALTER TABLE crops ADD COLUMN cultivated_date TEXT;
--> statement-breakpoint
ALTER TABLE crops ADD COLUMN harvested_date TEXT;
--> statement-breakpoint
CREATE TABLE seller_reviews (
 offer_id TEXT PRIMARY KEY NOT NULL REFERENCES offers(id),
 seller_id TEXT NOT NULL REFERENCES users(id),
 buyer_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5),
 comment TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX seller_review_owner ON seller_reviews(seller_id);
