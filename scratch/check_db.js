const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function run() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log("Found tenants:", tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug, dbUrl: t.dbUrl })));

    for (const t of tenants) {
      console.log(`\nChecking DB for Tenant: ${t.name} (${t.slug})`);
      try {
        const client = getTenantClient(t.dbUrl);
        const branches = await client.branch.findMany();
        const categories = await client.menuCategory.findMany({ include: { items: true } });
        console.log(`  Branches count: ${branches.length}`);
        console.log(`  Categories count: ${categories.length}`);
        for (const cat of categories) {
          console.log(`    Category: ${cat.name} (${cat.items.length} items)`);
          for (const item of cat.items) {
            console.log(`      Item: ${item.name} ($${item.price})`);
          }
        }
      } catch (err) {
        console.error(`  Error checking DB for ${t.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

run();
