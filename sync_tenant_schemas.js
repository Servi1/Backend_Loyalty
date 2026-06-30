const { PrismaClient } = require("@prisma/client-main");
const { execSync } = require("child_process");
const dotenv = require("dotenv");

// Load backend .env file
dotenv.config();

const mainPrisma = new PrismaClient();

async function main() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants in main database.`);

    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) {
      throw new Error("DATABASE_URL is not defined in the environment variables.");
    }
    for (const tenant of tenants) {
      const tenantDbUrl = tenant.dbUrl;
      console.log(`\nPushing schema to tenant ${tenant.slug}...`);

      try {
        execSync(`npx prisma db push --schema=prisma/schema.tenant.prisma --accept-data-loss --skip-generate`, {
          cwd: process.cwd(),
          env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
          stdio: "inherit",
        });
        console.log(`Successfully pushed schema to ${tenant.slug}.`);
      } catch (err) {
        console.error(`Failed to push schema to ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error executing script:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
