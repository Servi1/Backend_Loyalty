const { PrismaClient: MainPrisma } = require("@prisma/client-main");
const { PrismaClient: TenantPrisma } = require("@prisma/client-tenant");

async function test() {
  const mainDb = new MainPrisma();
  try {
    const tenant = await mainDb.tenant.findUnique({ where: { slug: "burgerking" } });
    if (!tenant) {
      console.log("Tenant burgerking not found in main DB.");
      return;
    }
    console.log("Found tenant slug:", tenant.slug);
    console.log("Tenant DB URL:", tenant.dbUrl);

    // Connect to tenant DB
    const tenantDb = new TenantPrisma({
      datasources: {
        db: {
          url: tenant.dbUrl
        }
      }
    });

    const branches = await tenantDb.branch.findMany();
    if (branches.length === 0) {
      console.log("No branches found in tenant DB.");
      return;
    }
    const branch = branches[0];
    console.log("Found branch:", branch.name);

    console.log("\n1. Testing create QrCashier...");
    const qrCashier = await tenantDb.qrCashier.create({
      data: {
        name: "BK Counter 1 Test",
        branchId: branch.id
      }
    });
    console.log("Created QR Cashier:", qrCashier);

    console.log("\n2. Testing findMany QrCashier...");
    const list = await tenantDb.qrCashier.findMany({
      where: { branchId: branch.id }
    });
    console.log("List of QR Cashiers:", list);

    console.log("\n3. Testing delete QrCashier...");
    await tenantDb.qrCashier.delete({
      where: { id: qrCashier.id }
    });
    console.log("Deleted QR Cashier successfully!");

  } catch (err) {
    console.error("Test failed with error:", err);
  } finally {
    await mainDb.$disconnect();
  }
}

test();
