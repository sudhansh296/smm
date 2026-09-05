-- Change supportsCancel default from true to false
-- Services that don't explicitly support cancel should not advertise it
ALTER TABLE "services" ALTER COLUMN "supportsCancel" SET DEFAULT false;
