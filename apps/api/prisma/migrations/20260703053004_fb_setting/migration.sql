-- CreateTable
CREATE TABLE "FbSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "FbSetting_key_key" ON "FbSetting"("key");
