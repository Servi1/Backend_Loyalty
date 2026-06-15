const { PrismaClient } = require("@prisma/client-main");
const prisma = new PrismaClient();
async function run() {
  const tenants = await prisma.tenant.findMany();
  console.log("Tenants:", tenants.map(t => ({ id: t.id, slug: t.slug, dbUrl: t.dbUrl })));
  await prisma.$disconnect();
}
run();
