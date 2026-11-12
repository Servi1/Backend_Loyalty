const { PrismaClient } = require("@prisma/client-main");

const mainPrisma = new PrismaClient();

mainPrisma.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "subscriptionPaused" BOOLEAN NOT NULL DEFAULT false;').catch(() => null);

module.exports = mainPrisma;
