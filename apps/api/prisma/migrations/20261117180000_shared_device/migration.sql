-- OFF-30 : session ouverte sur un appareil partagé.
ALTER TABLE "session" ADD COLUMN "shared_device" BOOLEAN NOT NULL DEFAULT false;
