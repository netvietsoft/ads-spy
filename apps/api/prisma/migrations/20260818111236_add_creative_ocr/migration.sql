-- CreateTable
CREATE TABLE "CreativeOcr" (
    "crId" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT,
    "text" TEXT,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
