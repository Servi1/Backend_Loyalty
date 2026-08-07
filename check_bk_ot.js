const { getTenantClient } = require("./src/config/tenantManager");
const mainPrisma = require("./src/config/prisma");

async function main() {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: "9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9" } });
  if (!tenant) return console.log("Tenant not found");
  
  const db = getTenantClient(tenant.dbUrl);

  const types = await db.customOrderType.findMany();
  console.log("\n=== All Custom Order Types ===");
  console.log(JSON.stringify(types, null, 2));

  const branch = await db.branch.findUnique({
    where: { id: "f687656d-4982-48bc-a118-10b4808b60cf" },
    include: { customOrderTypes: true },
  });
  console.log("\n=== Burger King Main Branch customOrderTypes ===");
  console.log(JSON.stringify(branch?.customOrderTypes, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
