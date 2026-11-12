-- Site-owner-requested removal. Match the exact listing and screenshot values.
-- Preserve accepted offers and history, using the normal archive behavior.
UPDATE crops SET archived=1,revision=revision+1
WHERE id='657af0ce-bfa3-4789-9081-cc201571aa7c'
  AND name='tomato' AND place='manglagiri'
  AND price=76800 AND qty=6578 AND archived=0;
--> statement-breakpoint
UPDATE offers SET status='declined'
WHERE crop_id='657af0ce-bfa3-4789-9081-cc201571aa7c'
  AND status='pending'
  AND EXISTS(SELECT 1 FROM crops WHERE id='657af0ce-bfa3-4789-9081-cc201571aa7c' AND archived=1);
