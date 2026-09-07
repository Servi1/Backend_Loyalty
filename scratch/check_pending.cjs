const mainPrisma = require('../src/config/prisma');

async function main() {
  const orders = await mainPrisma.aggregatedOrder.findMany({
    where: { status: 'PENDING' },
    include: { tenant: true }
  });
  console.log("Pending aggregated orders:", JSON.stringify(orders, null, 2));
}

main().catch(console.error).finally(() => mainPrisma.$disconnect());
