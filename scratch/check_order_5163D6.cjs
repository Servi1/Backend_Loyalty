const mainPrisma = require('../src/config/prisma');

async function main() {
  const order = await mainPrisma.aggregatedOrder.findFirst({
    where: { orderNumber: { contains: '5163D6' } },
    include: { tenant: true }
  });
  console.log("Order SRV-5163D6:", JSON.stringify(order, null, 2));
}

main().catch(console.error).finally(() => mainPrisma.$disconnect());
