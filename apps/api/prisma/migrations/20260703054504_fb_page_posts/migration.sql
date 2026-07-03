-- CreateTable
CREATE TABLE "FbPagePostsScan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "page" TEXT NOT NULL,
    "fromDate" TEXT,
    "toDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "FbPostRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT,
    "url" TEXT,
    "text" TEXT,
    "time" INTEGER,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "scanId" INTEGER NOT NULL,
    CONSTRAINT "FbPostRow_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "FbPagePostsScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
