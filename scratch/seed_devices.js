const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const bcrypt = require("bcryptjs");

async function run() {
  try {
    const tenant = await mainPrisma.tenant.findUnique({
      where: { slug: "servi" }
    });

    if (!tenant) {
      console.error("Tenant 'servi' not found.");
      return;
    }

    const tenantPrisma = getTenantClient(tenant.dbUrl);

    // Get the first branch
    const branch = await tenantPrisma.branch.findFirst();
    if (!branch) {
      console.error("No branch found for tenant 'servi'.");
      return;
    }

    console.log(`Using branch: ${branch.name} (${branch.id})`);

    // 1. Create or update Cashier user with a pinCode
    const cashierEmail = "cashier@servi.com";
    const cashierPin = "1234";
    const hashedStaffPassword = await bcrypt.hash("password123", 10);
    
    let cashier = await tenantPrisma.user.findUnique({
      where: { email: cashierEmail }
    });

    if (cashier) {
      cashier = await tenantPrisma.user.update({
        where: { email: cashierEmail },
        data: {
          pinCode: cashierPin,
          branchId: branch.id,
          role: "CASHIER"
        }
      });
      console.log("Updated existing cashier user with pinCode:", cashierPin);
    } else {
      cashier = await tenantPrisma.user.create({
        data: {
          email: cashierEmail,
          password: hashedStaffPassword,
          name: "Servi Cashier",
          pinCode: cashierPin,
          branchId: branch.id,
          role: "CASHIER"
        }
      });
      console.log("Created cashier user with pinCode:", cashierPin);
    }

    // 2. Create Kitchen user in the branch
    const kitchenEmail = "kitchen@servi.com";
    let kitchenUser = await tenantPrisma.user.findUnique({
      where: { email: kitchenEmail }
    });

    if (!kitchenUser) {
      kitchenUser = await tenantPrisma.user.create({
        data: {
          email: kitchenEmail,
          password: hashedStaffPassword,
          name: "Kitchen Staff",
          branchId: branch.id,
          role: "KITCHEN"
        }
      });
      console.log("Created kitchen user.");
    } else {
      kitchenUser = await tenantPrisma.user.update({
        where: { email: kitchenEmail },
        data: {
          branchId: branch.id,
          role: "KITCHEN"
        }
      });
      console.log("Updated kitchen user branch and role.");
    }

    // 3. Create POS Device
    const posKey = "DEV-12345";
    const posDevice = await tenantPrisma.posDevice.upsert({
      where: { deviceKey: posKey },
      create: {
        name: "Terminal 1",
        deviceKey: posKey,
        branchId: branch.id,
        isActive: true
      },
      update: {
        branchId: branch.id,
        isActive: true
      }
    });
    console.log("POS Device upserted:", posDevice.deviceKey);

    // 4. Create KDS Device
    const kdsKey = "KDS-12345";
    const kdsDevice = await tenantPrisma.kdsDevice.upsert({
      where: { deviceKey: kdsKey },
      create: {
        name: "KDS Terminal 1",
        deviceKey: kdsKey,
        branchId: branch.id,
        isActive: true
      },
      update: {
        branchId: branch.id,
        isActive: true
      }
    });
    console.log("KDS Device upserted:", kdsDevice.deviceKey);

    console.log("Seeding devices complete!");
  } catch (error) {
    console.error("Error seeding devices:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
