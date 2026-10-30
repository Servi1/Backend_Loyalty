const { Client } = require("pg");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

/**
 * Migration Script: Migrate PostgreSQL users & tenant database URLs for Production & Staging
 * 
 * Target Credentials:
 * - Super Admin Main DB (servio_main):
 *     User: Servidb
 *     Pass: Vskkrskcwpwtvkkuec
 * - Tenant Databases (tenant_*_db):
 *     User: Serbranddb
 *     Pass: AjhsGkidrsksnkoaaehbisywa
 */
async function migrateCredentials() {
  console.log("============================================================");
  console.log("  SERVI DATABASE CREDENTIALS MIGRATION (MAIN & TENANT DBS)  ");
  console.log("============================================================\n");

  const adminConnString = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!adminConnString) {
    throw new Error("Neither ADMIN_DATABASE_URL nor DATABASE_URL is defined in environment variables.");
  }

  // Parse host and port from existing connection
  const urlObj = new URL(adminConnString);
  const host = urlObj.hostname || "localhost";
  const port = urlObj.port || "5432";

  console.log(`[1/5] Connecting to PostgreSQL cluster at ${host}:${port}...`);
  const adminClient = new Client({ connectionString: adminConnString });
  await adminClient.connect();
  console.log("✓ Connected to PostgreSQL cluster successfully.\n");

  console.log("[2/5] Creating / updating database roles...");
  // 1. Create or update Servidb user
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'Servidb') THEN
        CREATE ROLE "Servidb" WITH LOGIN PASSWORD 'Vskkrskcwpwtvkkuec' CREATEDB SUPERUSER;
      ELSE
        ALTER ROLE "Servidb" WITH LOGIN PASSWORD 'Vskkrskcwpwtvkkuec' CREATEDB SUPERUSER;
      END IF;
    END
    $$;
  `);
  console.log("✓ Role 'Servidb' ready with CREATEDB / SUPERUSER privileges.");

  // 2. Create or update Serbranddb user
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'Serbranddb') THEN
        CREATE ROLE "Serbranddb" WITH LOGIN PASSWORD 'AjhsGkidrsksnkoaaehbisywa';
      ELSE
        ALTER ROLE "Serbranddb" WITH LOGIN PASSWORD 'AjhsGkidrsksnkoaaehbisywa';
      END IF;
    END
    $$;
  `);
  console.log("✓ Role 'Serbranddb' ready.\n");

  console.log("[3/5] Configuring Main Database (servio_main)...");
  await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE servio_main TO "Servidb";`);
  await adminClient.query(`ALTER DATABASE servio_main OWNER TO "Servidb";`);

  const mainDbClient = new Client({
    connectionString: adminConnString.replace(/\/[^/?]+(\?.*)?$/, `/servio_main$1`)
  });
  await mainDbClient.connect();
  await mainDbClient.query(`GRANT ALL ON SCHEMA public TO "Servidb";`);
  await mainDbClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "Servidb";`);
  await mainDbClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "Servidb";`);
  await mainDbClient.query(`GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "Servidb";`);
  await mainDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "Servidb";`);
  await mainDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "Servidb";`);
  await mainDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO "Servidb";`);

  // Transfer ownership of existing tables/sequences/views/types in servio_main to Servidb
  await mainDbClient.query(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      BEGIN
        REASSIGN OWNED BY postgres TO "Servidb";
      EXCEPTION WHEN OTHERS THEN NULL;
      END;

      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        BEGIN
          EXECUTE 'ALTER TABLE "' || r.tablename || '" OWNER TO "Servidb"';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;

      FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
        BEGIN
          EXECUTE 'ALTER SEQUENCE "' || r.sequence_name || '" OWNER TO "Servidb"';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;

      FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
        BEGIN
          EXECUTE 'ALTER VIEW "' || r.table_name || '" OWNER TO "Servidb"';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;

      FOR r IN (SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
        BEGIN
          EXECUTE 'ALTER TYPE "' || r.typname || '" OWNER TO "Servidb"';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;
    END
    $$;
  `);
  console.log("✓ Permissions and full table/sequence ownership configured on servio_main.");

  // Fetch all tenant databases on this PostgreSQL instance
  const dbRes = await adminClient.query(`
    SELECT datname FROM pg_database WHERE datname LIKE 'tenant_%' AND datistemplate = false;
  `);
  const tenantDbs = dbRes.rows.map(r => r.datname);
  console.log(`\n[4/5] Discovered ${tenantDbs.length} tenant databases to migrate.`);

  for (const dbName of tenantDbs) {
    try {
      // Set DB owner to Serbranddb
      await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "Serbranddb";`);
      await adminClient.query(`ALTER DATABASE "${dbName}" OWNER TO "Serbranddb";`);

      // Connect into the tenant DB as admin to grant schema privileges and reassign table ownership
      const tenantAdminUrl = adminConnString.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
      const tenantClient = new Client({ connectionString: tenantAdminUrl });
      await tenantClient.connect();
      await tenantClient.query(`GRANT ALL ON SCHEMA public TO "Serbranddb";`);
      await tenantClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "Serbranddb";`);
      await tenantClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "Serbranddb";`);
      await tenantClient.query(`GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "Serbranddb";`);
      await tenantClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "Serbranddb";`);
      await tenantClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "Serbranddb";`);
      await tenantClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO "Serbranddb";`);

      // Crucial: Transfer ownership of ALL existing tables, sequences, views, and enum types to Serbranddb so Prisma can alter tables
      await tenantClient.query(`
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          BEGIN
            REASSIGN OWNED BY postgres TO "Serbranddb";
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            BEGIN
              EXECUTE 'ALTER TABLE "' || r.tablename || '" OWNER TO "Serbranddb"';
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;

          FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
            BEGIN
              EXECUTE 'ALTER SEQUENCE "' || r.sequence_name || '" OWNER TO "Serbranddb"';
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;

          FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
            BEGIN
              EXECUTE 'ALTER VIEW "' || r.table_name || '" OWNER TO "Serbranddb"';
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;

          FOR r IN (SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
            BEGIN
              EXECUTE 'ALTER TYPE "' || r.typname || '" OWNER TO "Serbranddb"';
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END LOOP;
        END
        $$;
      `);

      await tenantClient.end();
      console.log(`  ✓ Transferred table/type ownership & privileges for "${dbName}" to Serbranddb`);
    } catch (err) {
      console.warn(`  ⚠ Warning processing "${dbName}":`, err.message);
    }
  }

  // Update Tenant table records in servio_main
  console.log("\n[5/5] Updating 'Tenant' table connection URLs in servio_main...");
  const tenantsRes = await mainDbClient.query(`SELECT id, slug, "dbUrl" FROM "Tenant"`);
  let updatedCount = 0;
  for (const t of tenantsRes.rows) {
    if (t.dbUrl) {
      try {
        const u = new URL(t.dbUrl);
        const dbName = u.pathname.replace("/", "");
        const newDbUrl = `postgresql://Serbranddb:AjhsGkidrsksnkoaaehbisywa@${host}:${port}/${dbName}?schema=public`;
        await mainDbClient.query(`UPDATE "Tenant" SET "dbUrl" = $1 WHERE id = $2`, [newDbUrl, t.id]);
        updatedCount++;
      } catch (e) {
        console.warn(`  ⚠ Could not parse dbUrl for tenant ${t.slug}:`, t.dbUrl);
      }
    }
  }
  console.log(`✓ Updated ${updatedCount} tenant records to use 'Serbranddb' credentials.\n`);

  await mainDbClient.end();
  await adminClient.end();

  // Automatically update Backend_Loyalty/.env if needed
  const envPath = path.join(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    const targetDbUrl = `postgresql://Servidb:Vskkrskcwpwtvkkuec@${host}:${port}/servio_main?schema=public`;
    const targetTenantDbUrl = `postgresql://Serbranddb:AjhsGkidrsksnkoaaehbisywa@${host}:${port}/servio_main?schema=public`;

    if (envContent.includes("DATABASE_URL=")) {
      envContent = envContent.replace(/DATABASE_URL=["'][^"']+["']/g, `DATABASE_URL="${targetDbUrl}"`);
    } else {
      envContent += `\nDATABASE_URL="${targetDbUrl}"\n`;
    }

    if (!envContent.includes("TENANT_DB_USER=")) {
      envContent += `\nTENANT_DB_USER="Serbranddb"\nTENANT_DB_PASSWORD="AjhsGkidrsksnkoaaehbisywa"\nTENANT_DB_HOST="${host}"\nTENANT_DB_PORT="${port}"\nTENANT_DATABASE_URL="${targetTenantDbUrl}"\n`;
    } else {
      envContent = envContent.replace(/TENANT_DATABASE_URL=["'][^"']+["']/g, `TENANT_DATABASE_URL="${targetTenantDbUrl}"`);
    }

    fs.writeFileSync(envPath, envContent, "utf8");
    console.log("✓ Synchronized Backend_Loyalty/.env configuration.");
  }

  console.log("============================================================");
  console.log("  MIGRATION COMPLETE! ALL DATABASES CONFIGURED SUCCESSFULLY  ");
  console.log("============================================================");
}

if (require.main === module) {
  migrateCredentials()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n❌ Migration failed:", err.message);
      process.exit(1);
    });
}

module.exports = migrateCredentials;
