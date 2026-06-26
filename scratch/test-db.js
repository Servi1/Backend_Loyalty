const http = require("http");
const mainPrisma = require("../src/config/prisma");

function makeRequest(url, method = "GET", payload = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        ...headers
      }
    };

    if (payload) {
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            raw: body
          });
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  try {
    console.log("=== 1. Fetching Tenant from Main Database via Prisma ===");
    const tenant = await mainPrisma.tenant.findFirst();
    if (!tenant) {
      console.log("No tenants found in registry.");
      return;
    }
    console.log(`Found tenant: ${tenant.name} (${tenant.id})`);
    console.log("Database values before tests:");
    console.log("  subKds:", tenant.subKds);
    console.log("  kdsQuantity:", tenant.kdsQuantity);
    console.log("  subCds:", tenant.subCds);
    console.log("  cdsQuantity:", tenant.cdsQuantity);

    console.log("\n=== 2. Testing Tenant Info API ===");
    const infoRes = await makeRequest(
      `http://localhost:5000/api/tenant/${tenant.id}/info`,
      "GET",
      null,
      { "x-tenant-id": tenant.id }
    );
    console.log("Status:", infoRes.statusCode);
    if (infoRes.data && infoRes.data.success) {
      const tenantInfo = infoRes.data.data;
      console.log(`Tenant ${tenantInfo.name} Info loaded.`);
      console.log("  subKds:", tenantInfo.subKds);
      console.log("  kdsQuantity:", tenantInfo.kdsQuantity);
      console.log("  activeKdsCount (Kitchen users):", tenantInfo.activeKdsCount);
      console.log("  subCds:", tenantInfo.subCds);
      console.log("  cdsQuantity:", tenantInfo.cdsQuantity);
      console.log("  activeCdsCount:", tenantInfo.activeCdsCount);
    } else {
      console.error("Info API failed:", infoRes.data || infoRes.raw);
    }

    console.log("\n=== 3. Testing Tenant Market Buy (Upgrades) ===");
    const buyPayload = JSON.stringify({
      addPosCount: 0,
      addTableCount: 0,
      addBranchCount: 0,
      addKdsCount: 3,
      addCdsCount: 2
    });
    const buyRes = await makeRequest(
      `http://localhost:5000/api/tenant/${tenant.id}/market/buy`,
      "POST",
      buyPayload,
      { "x-tenant-id": tenant.id }
    );
    console.log("Status:", buyRes.statusCode);
    if (buyRes.data && buyRes.data.success) {
      console.log("Buy successful! API Response quantities:");
      console.log("  kdsQuantity:", buyRes.data.data.kdsQuantity);
      console.log("  cdsQuantity:", buyRes.data.data.cdsQuantity);

      // Verify in DB directly
      const updatedTenant = await mainPrisma.tenant.findUnique({ where: { id: tenant.id } });
      console.log("\n=== 4. Direct Database Verification ===");
      console.log("Updated values in database:");
      console.log("  kdsQuantity (expected increment by 3):", updatedTenant.kdsQuantity);
      console.log("  cdsQuantity (expected increment by 2):", updatedTenant.cdsQuantity);
    } else {
      console.error("Buy failed:", buyRes.data || buyRes.raw);
    }

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

runTests();
