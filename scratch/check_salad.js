const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function checkSalad() {
  const tenant = await mainPrisma.tenant.findFirst({ where: { slug: "servi" } });
  if (!tenant) {
    console.error("Servi tenant not found");
    return;
  }
  console.log(`Found tenant servi. dbUrl: ${tenant.dbUrl}`);
  const db = getTenantClient(tenant.dbUrl);
  const items = await db.$queryRaw`SELECT id, name, price, modifiers FROM "MenuItem" WHERE name ILIKE '%salad%'`;
  console.log("Salad items found in Servi DB:");
  console.log(JSON.stringify(items, null, 2));
  await mainPrisma.$disconnect();
}

checkSalad().catch(console.error);
