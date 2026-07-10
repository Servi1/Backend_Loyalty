const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function check() {
  try {
    const tenant = await mainPrisma.tenant.findUnique({
      where: { slug: "servi" }
    });

    if (!tenant) {
      console.log("Tenant 'servi' not found in main DB.");
      return;
    }

    console.log("Tenant found in main DB:", tenant.slug, tenant.dbUrl);

    const tenantPrisma = getTenantClient(tenant.dbUrl);

    const posDevices = await tenantPrisma.posDevice.findMany();
    console.log("POS Devices in tenant DB:", posDevices);

    const kdsDevices = await tenantPrisma.kdsDevice.findMany();
    console.log("KDS Devices in tenant DB:", kdsDevices);

    const users = await tenantPrisma.user.findMany();
    console.log("Users in tenant DB:", users.map(u => ({ email: u.email, role: u.role, pinCode: u.pinCode })));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

check();
