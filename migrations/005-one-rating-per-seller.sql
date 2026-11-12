CREATE TABLE seller_ratings (
 seller_id TEXT NOT NULL REFERENCES users(id),
 buyer_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5),
 comment TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 PRIMARY KEY(seller_id,buyer_id)
);
--> statement-breakpoint
INSERT INTO seller_ratings(seller_id,buyer_id,rating,comment,created,updated)
SELECT seller_id,buyer_id,rating,comment,created,updated FROM (
 SELECT *,ROW_NUMBER() OVER(PARTITION BY seller_id,buyer_id ORDER BY updated DESC,offer_id DESC) AS position
 FROM seller_reviews
) WHERE position=1;
--> statement-breakpoint
CREATE TABLE seller_demo_scores (
 seller_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
 score REAL NOT NULL CHECK(score BETWEEN 0 AND 5)
);
--> statement-breakpoint
INSERT INTO seller_demo_scores(seller_id,score)
SELECT id,(35 + (random() & 2147483647) % 15)/10.0 FROM users
WHERE role='farmer' AND id<>'sample-farmer';
