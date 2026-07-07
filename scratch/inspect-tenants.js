const { PrismaClient } = require("@prisma/client-main");
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany();
  console.log("Active Tenants and DB URLs:");
  tenants.forEach(t => {
    console.log(`- Slug: ${t.slug}, DB URL: ${t.dbUrl}`);
  });
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Error:", err);
});
