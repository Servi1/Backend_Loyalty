const mainPrisma = require('../src/config/prisma');

async function main() {
  const tenants = await mainPrisma.tenant.findMany();
  console.log("Tenants:", JSON.stringify(tenants.map(t => ({
    id: t.id,
    name: t.name,
    feeAppServi: t.feeAppServi,
    feeAppBrand: t.feeAppBrand,
    feePos: t.feePos,
    feeQrTable: t.feeQrTable
  })), null, 2));

  const orders = await mainPrisma.aggregatedOrder.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' }
  });
  console.log("Aggregated Orders sample:", JSON.stringify(orders.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: o.total,
    feeRate: o.feeRate,
    source: o.source,
    tenantId: o.tenantId
  })), null, 2));
}

main().catch(console.error).finally(() => mainPrisma.$disconnect());
