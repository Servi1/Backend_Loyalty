const { PrismaClient } = require("@prisma/client-main");

const mainPrisma = new PrismaClient();

mainPrisma.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;').catch(() => null);

module.exports = mainPrisma;
