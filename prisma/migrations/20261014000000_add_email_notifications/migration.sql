-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lastMessageEmailAt" TIMESTAMP(3);
