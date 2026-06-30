const { PrismaClient } = require("@prisma/client-main");

async function check() {
  const db = new PrismaClient();
  try {
    const tenants = await db.tenant.findMany();
    for (const t of tenants) {
      console.log(`Tenant slug: ${t.slug}, dbUrl: ${t.dbUrl}`);
    }
  } catch (err) {
    console.error("Error querying main db:", err);
  } finally {
    await db.$disconnect();
  }
}

check();
