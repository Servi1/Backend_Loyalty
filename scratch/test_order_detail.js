const { getSuperAdminOrderDetail } = require("../src/web/admin/tenants/tenants.service");

async function test() {
  try {
    const detail = await getSuperAdminOrderDetail("9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9", "bk_5pct_pending");
    console.log("Success! Detail fetched:", detail.orderNumber, detail.status);
  } catch (err) {
    console.error("Error fetching detail:", err);
  }
  process.exit(0);
}

test();
