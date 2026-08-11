const mainPrisma = require('../src/config/prisma');
const { PrismaClient: TenantPrismaClient } = require('@prisma/client-tenant');

async function main() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    for (const tenant of tenants) {
      console.log(`\n======================================================`);
      console.log(`TENANT: ${tenant.name} (${tenant.slug})`);
      console.log(`======================================================`);
      const tenantPrisma = new TenantPrismaClient({
        datasources: {
          db: {
            url: tenant.dbUrl
          }
        }
      });
      
      const customOrderTypes = await tenantPrisma.customOrderType.findMany();
      console.log("Custom Order Types in DB:");
      console.log(JSON.stringify(customOrderTypes.map(c => ({ id: c.id, name: c.name, isActive: c.isActive })), null, 2));

      const branches = await tenantPrisma.branch.findMany({
        include: {
          customOrderTypes: true
        }
      });
      console.log("\nBranches and their Custom Order Types:");
      for (const branch of branches) {
        console.log(`- Branch: ${branch.name} (${branch.id})`);
        console.log(`  Linked Order Types:`, branch.customOrderTypes.map(c => `${c.name} (${c.id}, isActive=${c.isActive})`));
      }
      
      await tenantPrisma.$disconnect();
    }
  } catch (err) {
    console.error("Error querying:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
