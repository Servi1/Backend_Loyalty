const mainPrisma = require("../src/config/prisma");
const http = require("http");

async function runTest() {
  // 1. Get the first tenant
  const tenant = await mainPrisma.tenant.findFirst();
  if (!tenant) {
    console.error("No tenants found in the database. Please seed first.");
    process.exit(1);
  }
  const tenantId = tenant.id;
  const originalMarketEnabled = tenant.marketEnabled;

  console.log(`Testing with tenant: ${tenant.name} (${tenantId})`);
  console.log(`Original marketEnabled value: ${originalMarketEnabled}`);

  // Helper function to call the endpoint
  function callMarketBuy() {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        addPosCount: 0,
        addTableCount: 0,
        addBranchCount: 0,
        addKdsCount: 0,
        addCdsCount: 0
      });

      const options = {
        hostname: "localhost",
        port: 5000,
        path: `/api/tenant/${tenantId}/market/buy`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-tenant-id": tenantId
        }
      };

      const req = http.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ statusCode: res.statusCode, body: parsed });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  try {
    // 2. Set marketEnabled = false
    console.log("Setting marketEnabled to false...");
    await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: { marketEnabled: false }
    });

    // 3. Request purchase -> Expect 403 Forbidden
    console.log("Sending purchase request when marketEnabled = false...");
    const resDisabled = await callMarketBuy();
    console.log("Response status code (expected 403):", resDisabled.statusCode);
    console.log("Response body:", resDisabled.body);

    if (resDisabled.statusCode !== 403) {
      throw new Error(`Expected 403 status, got ${resDisabled.statusCode}`);
    }
    console.log("✅ Correctly blocked purchase with 403!");

    // 4. Set marketEnabled = true
    console.log("Setting marketEnabled to true...");
    await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: { marketEnabled: true }
    });

    // 5. Request purchase -> Expect 200 Success
    console.log("Sending purchase request when marketEnabled = true...");
    const resEnabled = await callMarketBuy();
    console.log("Response status code (expected 200):", resEnabled.statusCode);
    console.log("Response body success:", resEnabled.body.success);

    if (resEnabled.statusCode !== 200 || !resEnabled.body.success) {
      throw new Error(`Expected 200 status and success: true, got ${resEnabled.statusCode}`);
    }
    console.log("✅ Correctly allowed purchase with 200!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Restore original value
    console.log(`Restoring original marketEnabled value to: ${originalMarketEnabled}`);
    await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: { marketEnabled: originalMarketEnabled }
    });
    await mainPrisma.$disconnect();
    console.log("Test finished.");
  }
}

runTest();
