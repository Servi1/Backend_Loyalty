const { PrismaClient } = require("@prisma/client-main");

const mainPrisma = new PrismaClient();

module.exports = mainPrisma;
