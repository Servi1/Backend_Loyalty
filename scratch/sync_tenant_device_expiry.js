const { PrismaClient } = require('@prisma/client-main');
const mainPrisma = new PrismaClient();
const { getTenantClient } = require('../src/config/tenantManager');

async function main() {
  console.log('--- Syncing Table and POS Device Expiry to End of Current Month ---');
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const tenants = await mainPrisma.tenant.findMany();
  for (const tenant of tenants) {
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      
      const tableRes = await tenantPrisma.table.updateMany({
        data: {
          expiresAt: endOfMonth,
          isActive: true
        }
      });
      console.log(`[${tenant.name}] Updated ${tableRes.count} tables to expiresAt: ${endOfMonth.toISOString()}`);

      const posRes = await tenantPrisma.posDevice.updateMany({
        data: {
          expiresAt: endOfMonth,
          isActive: true
        }
      });
      console.log(`[${tenant.name}] Updated ${posRes.count} POS devices to expiresAt: ${endOfMonth.toISOString()}`);
    } catch (err) {
      console.error(`Failed to update tenant ${tenant.name}:`, err.message);
    }
  }

  await mainPrisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
