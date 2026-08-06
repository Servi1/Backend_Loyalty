const { getTenantClient } = require("./src/config/tenantManager");
const mainPrisma = require("./src/config/prisma");

async function main() {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: "9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9" } });
  const db = getTenantClient(tenant.dbUrl);

  // Check who d276844d is and what branch they belong to
  const mystery = await db.user.findUnique({
    where: { id: "d276844d-d43b-41b2-a609-b0b01600150c" },
    select: { id: true, name: true, role: true, branchId: true, email: true }
  });
  console.log("\n=== Mystery user (has 9-5pm schedule) ===");
  console.log(JSON.stringify(mystery, null, 2));

  // Check waiter 1 bk's schedule and what date/day is today
  const today = new Date();
  const dayOfWeek = today.getDay();
  console.log(`\n=== Today is day ${dayOfWeek} (0=Sun, 1=Mon, ...) ===`);
  console.log("Today's date:", today.toISOString().split("T")[0]);

  const waiterSchedule = await db.staffSchedule.findFirst({
    where: { userId: "aacad4e6-d4b8-495d-b968-102831459d84", dayOfWeek }
  });
  console.log("\n=== waiter 1 bk schedule for today ===");
  console.log(JSON.stringify(waiterSchedule, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
