-- CreateTable
CREATE TABLE "Search" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advertiserCount" INTEGER NOT NULL DEFAULT 0,
    "creativeCount" INTEGER NOT NULL DEFAULT 0,
    "totalMin" INTEGER,
    "totalMax" INTEGER
);

-- CreateTable
CREATE TABLE "Advertiser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "arId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "adCount" INTEGER NOT NULL DEFAULT 0,
    "searchId" INTEGER NOT NULL,
    CONSTRAINT "Advertiser_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "crId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL DEFAULT '',
    "domain" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'unknown',
    "assetUrl" TEXT,
    "firstShown" INTEGER,
    "lastShown" INTEGER,
    "searchId" INTEGER NOT NULL,
    CONSTRAINT "Creative_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
