require('dotenv').config();
const { PrismaClient } = require("@prisma/client-main");
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function run() {
  console.log("Using DATABASE_URL:", process.env.DATABASE_URL);
  try {
    const tenants = await prisma.tenant.findMany();
    console.log("SUCCESS! Tenants count:", tenants.length);
    console.log(tenants.map(t => ({ id: t.id, slug: t.slug, dbUrl: t.dbUrl })));
  } catch (err) {
    console.error("FAILED to query:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
