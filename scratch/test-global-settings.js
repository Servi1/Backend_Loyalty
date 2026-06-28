const mainPrisma = require("../src/config/prisma");
const http = require("http");

async function runTest() {
  const tenant = await mainPrisma.tenant.findFirst();
  if (!tenant) {
    console.error("No tenants found in the database.");
    process.exit(1);
  }
  const tenantId = tenant.id;

  console.log("=== 1. Test Querying Settings via Database ===");
  // Let's call the settings service directly (or query DB) to see if it initializes
  const settingsService = require("../src/web/admin/settings/settings.service");
  let settings = await settingsService.getSettings();
  console.log("Database initialized settings:", settings);

  const marketEnabledSetting = settings.find(s => s.key === "marketEnabled");
  const originalVal = marketEnabledSetting ? marketEnabledSetting.value : "true";
  console.log(`Original marketEnabled value: ${originalVal}`);

  // Helper function to call the buy endpoint
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
    // 2. Set globally marketEnabled = false
    console.log("\n=== 2. Setting marketEnabled globally to false ===");
    await settingsService.updateSettings([{ key: "marketEnabled", value: "false" }]);
    
    // Check setting in DB
    const currentVal = await mainPrisma.systemSetting.findUnique({ where: { key: "marketEnabled" } });
    console.log("Database marketEnabled value:", currentVal.value);

    // 3. Try to purchase -> Expect 403 Forbidden
    console.log("Sending purchase request when marketEnabled globally is false...");
    const resDisabled = await callMarketBuy();
    console.log("Response status code (expected 403):", resDisabled.statusCode);
    console.log("Response message:", resDisabled.body.message);

    if (resDisabled.statusCode !== 403) {
      throw new Error(`Expected 403 status, got ${resDisabled.statusCode}`);
    }
    console.log("✅ Purchase successfully blocked with 403!");

    // 4. Set globally marketEnabled = true
    console.log("\n=== 3. Setting marketEnabled globally to true ===");
    await settingsService.updateSettings([{ key: "marketEnabled", value: "true" }]);

    // 5. Try to purchase -> Expect 200 Success
    console.log("Sending purchase request when marketEnabled globally is true...");
    const resEnabled = await callMarketBuy();
    console.log("Response status code (expected 200):", resEnabled.statusCode);
    console.log("Response body success:", resEnabled.body.success);

    if (resEnabled.statusCode !== 200 || !resEnabled.body.success) {
      throw new Error(`Expected 200 status, got ${resEnabled.statusCode}`);
    }
    console.log("✅ Purchase successfully allowed with 200!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Restore original value
    console.log(`\nRestoring original global marketEnabled value to: ${originalVal}`);
    await settingsService.updateSettings([{ key: "marketEnabled", value: originalVal }]);
    await mainPrisma.$disconnect();
    console.log("Test finished.");
  }
}

runTest();
