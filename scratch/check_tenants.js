const mainPrisma = require("../src/config/prisma");

async function check() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log("TENANTS COUNT:", tenants.length);
    console.log("TENANTS:", tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug, isActive: t.isActive })));
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    await mainPrisma.$disconnect();
  }
}

check();
