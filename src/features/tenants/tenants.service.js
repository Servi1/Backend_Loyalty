const mainPrisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const { Client } = require("pg");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const config = require("../../config");

const getAll = async () => mainPrisma.tenant.findMany();

const getById = async (id) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new ApiError(404, "Tenant not found");
  return tenant;
};

const create = async (data) => {
  // 1. Generate DB name based on slug
  const dbName = `tenant_${data.slug.replace(/[^a-zA-Z0-9]/g, "_")}_db`;
  
  // Extract base connection string from main database URL
  // e.g., postgresql://postgres:root@localhost:5432/servio_main?schema=public
  // becomes postgresql://postgres:root@localhost:5432
  const mainDbUrl = process.env.DATABASE_URL;
  const baseUrl = mainDbUrl.substring(0, mainDbUrl.lastIndexOf("/"));
  const tenantDbUrl = `${baseUrl}/${dbName}?schema=public`;

  // 2. Connect to the default DB to create the new database
  const client = new Client({ connectionString: mainDbUrl });
  
  try {
    await client.connect();
    // In PostgreSQL, CREATE DATABASE cannot run inside a transaction block
    await client.query(`CREATE DATABASE ${dbName}`);
  } catch (err) {
    if (err.code !== "42P04") { // 42P04 = duplicate_database
      throw new ApiError(500, `Failed to create physical database: ${err.message}`);
    }
  } finally {
    await client.end();
  }

  // 3. Push schema to the new database
  try {
    console.log(`Pushing schema to ${dbName}...`);
    // Run prisma db push using the specific schema and injecting the URL
    await execPromise(`npx prisma db push --schema=prisma/schema.tenant.prisma`, {
      env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
    });
  } catch (err) {
    throw new ApiError(500, `Failed to push schema to tenant DB: ${err.message}`);
  }

  // 4. Save tenant to main registry
  const tenant = await mainPrisma.tenant.create({
    data: {
      ...data,
      dbUrl: tenantDbUrl,
    },
  });

  return tenant;
};

const update = async (id, data) => {
  await getById(id);
  return mainPrisma.tenant.update({ where: { id }, data });
};

const remove = async (id) => {
  await getById(id);
  // Optional: drop the database physically, or leave it for safety
  return mainPrisma.tenant.delete({ where: { id } });
};

module.exports = { getAll, getById, create, update, remove };
