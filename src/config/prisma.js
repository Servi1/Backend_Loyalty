const { PrismaClient } = require("@prisma/client-main");

const mainPrisma = new PrismaClient();

mainPrisma.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "subscriptionPaused" BOOLEAN NOT NULL DEFAULT false;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "subPager" BOOLEAN NOT NULL DEFAULT false;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pagerQuantity" INTEGER NOT NULL DEFAULT 5;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pricePager" DOUBLE PRECISION NOT NULL DEFAULT 19.0;').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "cyclePager" TEXT NOT NULL DEFAULT \'monthly\';').catch(() => null);
mainPrisma.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "feePager" DOUBLE PRECISION NOT NULL DEFAULT 0.0;').catch(() => null);

module.exports = mainPrisma;
