const { PrismaClient } = require("@prisma/client-tenant");

async function inspect() {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: "postgresql://postgres:root@localhost:5432/tenant_testbrand_db?schema=public"
      }
    }
  });

  try {
    const raw = await client.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Branch';
    `;
    console.log("Branch table columns:", raw);
  } catch (err) {
    console.error("Error inspecting database:", err);
  } finally {
    await client.$disconnect();
  }
}

inspect();
