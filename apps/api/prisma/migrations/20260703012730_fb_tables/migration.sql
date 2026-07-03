-- CreateTable
CREATE TABLE "FbSearch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "query" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "FbAd" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "adArchiveId" TEXT NOT NULL,
    "pageId" TEXT,
    "pageName" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN,
    "platforms" TEXT,
    "bodyText" TEXT,
    "linkUrl" TEXT,
    "ctaText" TEXT,
    "images" TEXT,
    "videos" TEXT,
    "startedRunning" TEXT,
    "snapshotUrl" TEXT,
    "fbSearchId" INTEGER NOT NULL,
    CONSTRAINT "FbAd_fbSearchId_fkey" FOREIGN KEY ("fbSearchId") REFERENCES "FbSearch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
