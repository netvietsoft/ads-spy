-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginIp" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "ip" TEXT;
