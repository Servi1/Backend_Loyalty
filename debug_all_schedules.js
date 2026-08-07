const { getTenantClient } = require("./src/config/tenantManager");
const mainPrisma = require("./src/config/prisma");

async function main() {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: "9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9" } });
  const db = getTenantClient(tenant.dbUrl);

  const users = await db.user.findMany({
    include: {
      schedules: true,
      branch: true
    }
  });

  console.log("\n=== ALL USERS IN TENANT DB WITH SCHEDULES ===");
  for (const u of users) {
    console.log(`User: ${u.name} (id: ${u.id}, role: ${u.role}, branch: ${u.branch?.name || u.branchId})`);
    if (u.schedules && u.schedules.length > 0) {
      console.log("  Schedules:", JSON.stringify(u.schedules, null, 2));
    } else {
      console.log("  Schedules: NONE");
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
