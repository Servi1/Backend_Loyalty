const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

// Riyadh Center Coordinate
const RIYADH_LAT = 24.7136;
const RIYADH_LNG = 46.6753;
const VARIANCE = 0.08; // ~8-10 km radius variance

async function updateCoordinates() {
  try {
    console.log("🔍 Fetching all tenants from main database...");
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants.`);

    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name} (${tenant.slug})`);
      const tenantPrisma = getTenantClient(tenant.dbUrl);

      // Find branches with null lat or lng
      const branches = await tenantPrisma.branch.findMany({
        where: {
          OR: [
            { lat: null },
            { lng: null }
          ]
        }
      });

      console.log(`   └─ Found ${branches.length} branches missing coordinates.`);

      for (const branch of branches) {
        // Generate random offset within ~10km of Riyadh center
        const randomLat = RIYADH_LAT + (Math.random() - 0.5) * VARIANCE;
        const randomLng = RIYADH_LNG + (Math.random() - 0.5) * VARIANCE;

        await tenantPrisma.branch.update({
          where: { id: branch.id },
          data: {
            lat: randomLat,
            lng: randomLng
          }
        });

        console.log(`      └─ Updated branch "${branch.name}" to location: [${randomLat.toFixed(5)}, ${randomLng.toFixed(5)}]`);
      }

      // Disconnect tenant database client
      try {
        await tenantPrisma.$disconnect();
      } catch (err) {
        // ignore
      }
    }
    console.log("\n✅ Done updating all branch coordinates!");
  } catch (error) {
    console.error("❌ Failed to update coordinates:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

updateCoordinates();
