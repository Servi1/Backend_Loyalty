const { PrismaClient } = require("@prisma/client-main");
const { execSync } = require("child_process");
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany();
  console.log(`Found ${tenants.length} tenants. Running migrations...`);
  
  for (const tenant of tenants) {
    if (!tenant.dbUrl) {
      console.warn(`Skipping tenant ${tenant.slug} - No database URL defined.`);
      continue;
    }
    console.log(`\n========================================`);
    console.log(`Migrating database for tenant: ${tenant.slug}`);
    console.log(`DB URL: ${tenant.dbUrl}`);
    console.log(`========================================`);
    
    try {
      // Execute prisma db push with custom TENANT_DATABASE_URL environment variable
      execSync("npx prisma db push --schema=prisma/schema.tenant.prisma", {
        env: {
          ...process.env,
          TENANT_DATABASE_URL: tenant.dbUrl
        },
        stdio: "inherit"
      });
      console.log(`Successfully migrated tenant: ${tenant.slug}`);
    } catch (err) {
      console.error(`Failed to migrate tenant ${tenant.slug}:`, err.message);
    }
  }
  
  await prisma.$disconnect();
  console.log("\nAll migrations completed.");
}

main().catch(err => {
  console.error("Migration runner error:", err);
});
