const mainPrisma = require('../src/config/prisma');

async function main() {
  try {
    const globalOrderTypes = await mainPrisma.globalOrderType.findMany();
    console.log("Global Order Types in Main DB:");
    console.log(JSON.stringify(globalOrderTypes, null, 2));
  } catch (err) {
    console.error("Error querying:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
