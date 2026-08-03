const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function inspect() {
  const tenants = await mainPrisma.tenant.findMany();
  for (const t of tenants) {
    console.log(`\nTenant: ${t.name} (${t.slug})`);
    const db = getTenantClient(t.dbUrl);
    try {
      const orderTypes = await db.customOrderType.findMany({
        include: { branches: true }
      });
      console.log("Custom Order Types:", orderTypes.map(ot => ({
        id: ot.id,
        name: ot.name,
        isActive: ot.isActive,
        branchesCount: ot.branches.length
      })));
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
  await mainPrisma.$disconnect();
}

inspect();
