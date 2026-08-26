-- CreateTable
CREATE TABLE "CreativeDetailCache" (
    "crId" TEXT NOT NULL PRIMARY KEY,
    "regions" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'unknown',
    "domain" TEXT,
    "thumb" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
