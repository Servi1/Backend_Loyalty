const mainPrisma = require("../src/config/prisma");

async function run() {
  const slug = process.argv[2] || "olive-oak";
  const action = process.argv[3] || "status"; // status, enable, disable

  try {
    const tenant = await mainPrisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      console.log(`Tenant with slug '${slug}' not found.`);
      return;
    }

    if (action === "enable") {
      await mainPrisma.tenant.update({
        where: { id: tenant.id },
        data: { subQrTable: true, subQrCashier: true }
      });
      console.log(`Enabled QR Table & QR Cashier for ${tenant.name}.`);
    } else if (action === "disable") {
      await mainPrisma.tenant.update({
        where: { id: tenant.id },
        data: { subQrTable: false, subQrCashier: false }
      });
      console.log(`Disabled QR Table & QR Cashier for ${tenant.name}.`);
    } else {
      console.log(`Tenant: ${tenant.name}`);
      console.log(`  subQrTable: ${tenant.subQrTable}`);
      console.log(`  subQrCashier: ${tenant.subQrCashier}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
