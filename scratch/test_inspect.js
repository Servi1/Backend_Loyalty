const axios = require("axios");

async function main() {
  try {
    const { PrismaClient } = require("@prisma/client-main");
    const prisma = new PrismaClient();
    const tenants = await prisma.tenant.findMany();
    await prisma.$disconnect();

    const tenant = tenants.find(t => t.slug === "burgerking" || t.slug === "amigos");
    if (!tenant) {
      console.log("No tenant found");
      return;
    }

    console.log(`Testing API for tenant slug: ${tenant.slug}, ID: ${tenant.id}`);
    
    const res = await axios.get(`http://localhost:5000/api/tenant/${tenant.id}/menus/items`);
    console.log("API response items:");
    res.data.data.forEach(i => {
      console.log(`- Item: ${i.name}, Modifiers:`, JSON.stringify(i.modifiers));
    });
  } catch (err) {
    console.error("API request failed:", err.message);
  }
}

main();
