const mainPrisma = require('../src/config/prisma');

async function verify() {
  const tenantsCount = await mainPrisma.tenant.count();
  const aggregatedOrdersCount = await mainPrisma.aggregatedOrder.count();
  const appUsersCount = await mainPrisma.appUser.count();
  const walletsCount = await mainPrisma.wallet.count();
  const superAdmins = await mainPrisma.superAdmin.findMany();

  console.log("=== DB CLEANUP STATUS ===");
  console.log(`- Tenants: ${tenantsCount}`);
  console.log(`- Aggregated Orders: ${aggregatedOrdersCount}`);
  console.log(`- App Users: ${appUsersCount}`);
  console.log(`- Wallets: ${walletsCount}`);
  console.log(`- Super Admins: ${superAdmins.length}`);
  superAdmins.forEach(sa => console.log(`  👑 ${sa.email} (${sa.role})`));
}

verify().catch(console.error).finally(() => mainPrisma.$disconnect());
