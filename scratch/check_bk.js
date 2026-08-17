const { PrismaClient } = require('@prisma/client');
const mainPrisma = new PrismaClient();
const { getTenantClient } = require('../src/config/tenantManager');

async function main() {
  const tenants = await mainPrisma.tenant.findMany({});
  const bk = tenants.find(t => t.name.toLowerCase().includes('burger'));
  if (!bk) {
    console.log('No Burger King tenant found');
    return;
  }

  const bkPrisma = getTenantClient(bk.dbUrl);

  const branches = await bkPrisma.branch.findMany({});
  const categories = await bkPrisma.category.findMany({ include: { menuItems: true } });
  const customers = await bkPrisma.customer.findMany({});
  const orders = await bkPrisma.order.findMany({ include: { items: true } });

  console.log(`Burger King Tenant (${bk.name}):`);
  console.log(`Fee rates -> App Servi: ${bk.feeAppServi || 5}%, App Brand: ${bk.feeAppBrand || 2}%, POS: ${bk.feePos || 5.2}%`);
  console.log(`Branches (${branches.length}):`, branches.map(b => ({ id: b.id, name: b.name })));
  console.log(`Categories with Items:`, categories.map(c => ({ name: c.name, itemsCount: c.menuItems.length, items: c.menuItems.map(i => ({ id: i.id, name: i.name, price: i.price })) })));
  console.log(`Customers (${customers.length}):`, customers.map(c => ({ id: c.id, name: c.name, phone: c.phone })));
  console.log(`Current Orders Count:`, orders.length);
  console.log(`Status Breakdown:`, orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}));
}

main().catch(console.error).finally(() => mainPrisma.$disconnect());
