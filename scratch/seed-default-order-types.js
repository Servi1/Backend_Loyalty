const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

const DEFAULT_ORDER_TYPES = [
  "Dine In",
  "Takeaway",
  "Delivery",
  "Deliver to Car",
  "Scheduled"
];

async function seed() {
  const tenants = await mainPrisma.tenant.findMany();
  for (const t of tenants) {
    console.log(`\nProcessing Tenant: ${t.name} (${t.slug})`);
    const db = getTenantClient(t.dbUrl);
    try {
      const existing = await db.customOrderType.findMany();
      const existingNames = new Set(existing.map(ot => ot.name.toLowerCase().trim()));

      const toCreate = DEFAULT_ORDER_TYPES.filter(name => !existingNames.has(name.toLowerCase().trim()));
      if (toCreate.length > 0) {
        console.log(`Creating order types: ${toCreate.join(", ")}`);
        await db.customOrderType.createMany({
          data: toCreate.map(name => ({ name, isActive: true }))
        });
      } else {
        console.log("All default order types already exist.");
      }
    } catch (e) {
      console.error("Error seeding tenant order types:", e.message);
    }
  }
  await mainPrisma.$disconnect();
}

seed();
