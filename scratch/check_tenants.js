const { PrismaClient } = require('../node_modules/@prisma/client-main');
const mainPrisma = new PrismaClient();
const brandsService = require('../src/app/brands/brands.service');

async function main() {
  const tenants = await mainPrisma.tenant.findMany({});
  console.log('--- Database Tenants ---');
  console.log(tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug, category: t.category })));

  console.log('\n--- Brands returned by Service ---');
  // Mock a user ID to call getBrands
  const users = await mainPrisma.appUser.findMany({ take: 1 });
  if (users.length > 0) {
    const brands = await brandsService.getBrands(users[0].id);
    console.log(brands.map(b => ({ id: b.id, name: b.name, slug: b.slug, category: b.category, cuisine: b.cuisine })));
  } else {
    console.log('No app users found to test');
  }
}

main().catch(console.error).finally(() => mainPrisma.$disconnect());
