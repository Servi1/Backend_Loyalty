const mainPrisma = require('../src/config/prisma');

async function run() {
  const tenants = await mainPrisma.tenant.findMany();
  console.log('--- ALL TENANTS ---');
  console.log(JSON.stringify(tenants, null, 2));
  await mainPrisma.$disconnect();
}

run().catch(console.error);
