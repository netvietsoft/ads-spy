-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncSourceStore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    "status" TEXT NOT NULL DEFAULT 'active',
    "cronEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "lastScrapedAt" DATETIME,
    "lastStatusMessage" TEXT,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncTargetStore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'shopify',
    "apiType" TEXT NOT NULL DEFAULT 'shopify_admin_rest',
    "accessToken" TEXT,
    "apiVersion" TEXT NOT NULL DEFAULT '2024-01',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sourceStoreId" INTEGER NOT NULL,
    "targetStoreId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceMultiplier" REAL NOT NULL DEFAULT 1.0,
    "priceAddition" REAL NOT NULL DEFAULT 0.0,
    "priceRounding" TEXT NOT NULL DEFAULT 'none',
    "overrideVendor" TEXT,
    "tagAction" TEXT NOT NULL DEFAULT 'keep',
    "tagsToAdd" TEXT,
    "titlePrefix" TEXT,
    "titleSuffix" TEXT,
    "removeWords" TEXT,
    "productStatus" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncRule_sourceStoreId_fkey" FOREIGN KEY ("sourceStoreId") REFERENCES "SyncSourceStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncRule_targetStoreId_fkey" FOREIGN KEY ("targetStoreId") REFERENCES "SyncTargetStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceStoreId" INTEGER NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "tags" TEXT,
    "optionsRaw" TEXT NOT NULL,
    "variantsRaw" TEXT NOT NULL,
    "imagesRaw" TEXT NOT NULL,
    "sourcePublishedAt" DATETIME,
    "sourceCreatedAt" DATETIME,
    "sourceUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncProduct_sourceStoreId_fkey" FOREIGN KEY ("sourceStoreId") REFERENCES "SyncSourceStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "syncProductId" INTEGER NOT NULL,
    "targetStoreId" INTEGER NOT NULL,
    "targetProductId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_syncProductId_fkey" FOREIGN KEY ("syncProductId") REFERENCES "SyncProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncLog_targetStoreId_fkey" FOREIGN KEY ("targetStoreId") REFERENCES "SyncTargetStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncSourceStore_domain_key" ON "SyncSourceStore"("domain");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncRule_sourceStoreId_targetStoreId_key" ON "SyncRule"("sourceStoreId", "targetStoreId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncProduct_sourceStoreId_idx" ON "SyncProduct"("sourceStoreId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncProduct_handle_idx" ON "SyncProduct"("handle");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncProduct_sourceStoreId_sourceProductId_key" ON "SyncProduct"("sourceStoreId", "sourceProductId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncLog_targetStoreId_idx" ON "SyncLog"("targetStoreId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncLog_syncProductId_targetStoreId_key" ON "SyncLog"("syncProductId", "targetStoreId");
