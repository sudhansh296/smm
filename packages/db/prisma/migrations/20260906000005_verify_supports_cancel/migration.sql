-- supportsCancel was defaulted true before the field was properly synced from provider.
-- Since we cannot know which services actually support cancel without re-syncing,
-- we leave existing values as-is but add a comment for admin awareness.
-- Admin should re-sync providers to get accurate supportsCancel values.
-- This migration only ensures the comment/documentation is in place.
SELECT 1; -- no-op migration for documentation purposes
