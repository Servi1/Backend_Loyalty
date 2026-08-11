const mainPrisma = require('../src/config/prisma');
const { getTenantClient } = require('../src/config/tenantManager');

const defaultOrderTypes = [
  { name: "Dine In", description: "Enjoy your meal served directly at your table inside our restaurant." },
  { name: "Takeaway", description: "Pick up your order directly from the counter when ready." },
  { name: "Delivery", description: "Your order is cooked fresh and delivered to your doorstep." },
  { name: "Deliver to Car", description: "Curbside service — we bring your food right to your parked vehicle." },
  { name: "Scheduled", description: "Book an appointment for a specific date and time slot with our specialists." },
  { name: "Home Service", description: "Our specialist visits your home or office at your scheduled appointment time." }
];

async function main() {
  try {
    // 1. Seed Main GlobalOrderType
    const count = await mainPrisma.globalOrderType.count();
    if (count === 0) {
      console.log("Seeding default global order types in main DB...");
      for (const item of defaultOrderTypes) {
        await mainPrisma.globalOrderType.create({
          data: { name: item.name, description: item.description, isActive: true }
        });
      }
      console.log("✅ Seeding complete.");
    } else {
      console.log(`ℹ️ Main DB already has ${count} global order types.`);
    }

    const globals = await mainPrisma.globalOrderType.findMany();
    const tenants = await mainPrisma.tenant.findMany();

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.name} (${tenant.slug})`);
      const db = getTenantClient(tenant.dbUrl);

      // 2. Sync to CustomOrderType
      const syncedCustomTypes = [];
      for (const g of globals) {
        let local = await db.customOrderType.findFirst({
          where: { name: { equals: g.name, mode: "insensitive" } }
        });

        if (!local) {
          local = await db.customOrderType.create({
            data: {
              name: g.name,
              description: g.description,
              isActive: g.isActive
            }
          });
          console.log(`  + Created CustomOrderType: ${g.name}`);
        } else {
          local = await db.customOrderType.update({
            where: { id: local.id },
            data: {
              name: g.name,
              description: g.description,
              isActive: g.isActive
            }
          });
          console.log(`  * Updated CustomOrderType: ${g.name}`);
        }
        syncedCustomTypes.push(local);
      }

      // Filter active custom order types (excluding scheduled as per front-end design)
      const activeCustomTypes = syncedCustomTypes.filter(c => c.isActive && c.name.toLowerCase() !== 'scheduled');

      // 3. Link branches to all active CustomOrderTypes
      const branches = await db.branch.findMany();
      for (const branch of branches) {
        console.log(`  - Linking branch: ${branch.name}`);
        await db.branch.update({
          where: { id: branch.id },
          data: {
            customOrderTypes: {
              set: activeCustomTypes.map(c => ({ id: c.id }))
            }
          }
        });
      }
      console.log(`✅ Synced and linked for tenant ${tenant.slug}`);
    }
  } catch (err) {
    console.error("Error executing sync:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
