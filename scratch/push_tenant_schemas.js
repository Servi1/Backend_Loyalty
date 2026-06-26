/**
 * push_tenant_schemas.js — push the tenant schema to all active tenant DBs
 */
const mainPrisma = require('../src/config/prisma');

const { execSync } = require('child_process');

async function pushAll() {
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
  for (const t of tenants) {
    console.log(`\nPushing schema to: ${t.name} (${t.slug})`);
    try {
      execSync('npx prisma db push --schema=prisma/schema.tenant.prisma --accept-data-loss', {
        env: { ...process.env, TENANT_DATABASE_URL: t.dbUrl },
        stdio: 'inherit'
      });
      console.log('  ✅ Schema pushed.');
    } catch (e) {
      console.error('  ❌ Failed:', e.message);
    }
  }
  await mainPrisma.$disconnect();
}

pushAll().catch(e => { console.error(e); process.exit(1); });
