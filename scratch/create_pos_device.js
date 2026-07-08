const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function run() {
  try {
    const tenant = await mainPrisma.tenant.findUnique({ where: { slug: "servi" } });
    if (!tenant) {
      console.log("Tenant 'servi' not found.");
      return;
    }
    const db = getTenantClient(tenant.dbUrl);

    // 1. Find the first branch
    const branch = await db.branch.findFirst();
    if (!branch) {
      console.log("No branches found in 'servi' database.");
      return;
    }

    // 2. Create or update PosDevice
    const deviceKey = "DEV-12345678";
    const posDevice = await db.posDevice.upsert({
      where: { deviceKey },
      update: { branchId: branch.id, name: "POS Terminal 1", isActive: true },
      create: {
        deviceKey,
        name: "POS Terminal 1",
        branchId: branch.id,
        isActive: true,
      }
    });

    // 3. Set a pin code for the cashier user in the same branch
    const cashier = await db.user.findFirst({
      where: { role: "CASHIER" }
    });

    if (cashier) {
      await db.user.update({
        where: { id: cashier.id },
        data: {
          pinCode: "1234",
          branchId: branch.id // Ensure they are in the same branch
        }
      });
      console.log(`✅ Success!`);
      console.log(`POS Device Key: ${deviceKey}`);
      console.log(`Cashier PIN: 1234`);
      console.log(`Branch Name: ${branch.name}`);
    } else {
      console.log("Cashier user not found in tenant database.");
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
