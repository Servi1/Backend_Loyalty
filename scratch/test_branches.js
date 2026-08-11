const mainPrisma = require('../src/config/prisma');
const { PrismaClient: TenantPrismaClient } = require('@prisma/client-tenant');

async function main() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log("TENANTS FOUND:", tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug, dbUrl: t.dbUrl })));
    for (const tenant of tenants) {
      console.log(`\nQuerying branches for tenant: ${tenant.name} (${tenant.slug})`);
      const tenantPrisma = new TenantPrismaClient({
        datasources: {
          db: {
            url: tenant.dbUrl
          }
        }
      });
      const branches = await tenantPrisma.branch.findMany();
      console.log(JSON.stringify(branches.map(b => ({ id: b.id, name: b.name, address: b.address, city: b.city })), null, 2));
      await tenantPrisma.$disconnect();
    }
  } catch (err) {
    console.error("Error querying:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
