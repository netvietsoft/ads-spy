-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FbPostRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT,
    "url" TEXT,
    "text" TEXT,
    "time" INTEGER,
    "image" TEXT,
    "isVideo" BOOLEAN NOT NULL DEFAULT false,
    "hasActiveAd" BOOLEAN NOT NULL DEFAULT false,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "scanId" INTEGER NOT NULL,
    CONSTRAINT "FbPostRow_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "FbPagePostsScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FbPostRow" ("comments", "id", "postId", "reactions", "scanId", "shares", "text", "time", "total", "url") SELECT "comments", "id", "postId", "reactions", "scanId", "shares", "text", "time", "total", "url" FROM "FbPostRow";
DROP TABLE "FbPostRow";
ALTER TABLE "new_FbPostRow" RENAME TO "FbPostRow";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
