const { PrismaClient } = require('@prisma/client-main');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Cleaning up Yearly Subscriptions in Main DB ---');

  const result = await prisma.tenant.updateMany({
    data: {
      billingCycle: 'monthly',
      cycleAppServi: 'monthly',
      cycleAppBrand: 'monthly',
      cycleBrandStory: 'monthly',
      cyclePos: 'monthly',
      cycleQrTable: 'monthly',
      cycleQrCashier: 'monthly',
      cycleKds: 'monthly',
      cycleCds: 'monthly',
      cycleBranch: 'monthly',
    }
  });

  console.log(`Updated ${result.count} tenants to monthly billing cycle.`);

  const tenants = await prisma.tenant.findMany();
  for (const t of tenants) {
    console.log(`Tenant ${t.name} (${t.slug}): billingCycle = ${t.billingCycle}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error running script:', err);
  process.exit(1);
});
