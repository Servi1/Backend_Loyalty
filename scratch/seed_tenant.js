const tenantsService = require("../src/web/admin/tenants/tenants.service");
const mainPrisma = require("../src/config/prisma");

async function seed() {
  try {
    const tenant = await tenantsService.create({
      name: "Servi",
      slug: "servi",
      adminEmail: "admin@servi.com",
      adminPassword: "password123",
      contactEmail: "contact@servi.com",
      phone: "+1234567890",
      website: "https://servi.app",
      isActive: true,
      loyaltyEnabled: true,
      loyaltyEarnRate: 1.0,
      loyaltyRedeemRate: 100.0,
    });
    console.log("Tenant created successfully:", tenant);
  } catch (error) {
    console.error("Failed to seed tenant:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

seed();
