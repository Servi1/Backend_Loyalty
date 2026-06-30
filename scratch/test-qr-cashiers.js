const axios = require("axios");

async function test() {
  const tenantId = "burgerking"; // BK tenant
  const baseUrl = `http://localhost:5000/api/tenant/${tenantId}`;
  
  try {
    console.log("Fetching branches...");
    const branchesRes = await axios.get(`${baseUrl}/branches`);
    const branches = branchesRes.data.data;
    if (branches.length === 0) {
      console.log("No branches found, cannot test.");
      return;
    }
    const branchId = branches[0].id;
    console.log("Using branch ID:", branchId);

    console.log("\n1. Testing GET /qr-cashiers...");
    const getRes = await axios.get(`${baseUrl}/qr-cashiers`);
    console.log("GET Response:", getRes.data);

    console.log("\n2. Testing POST /qr-cashiers...");
    const postRes = await axios.post(`${baseUrl}/qr-cashiers`, {
      name: "Test Cashier Station " + Date.now(),
      branchId: branchId
    }, {
      headers: { "x-tenant-id": tenantId } // Admin authorization mock bypass or credentials
    });
    console.log("POST Response:", postRes.data);
    const newId = postRes.data.data.id;

    console.log("\n3. Testing PUT /qr-cashiers/:id...");
    const putRes = await axios.put(`${baseUrl}/qr-cashiers/${newId}`, {
      name: "Updated Name"
    });
    console.log("PUT Response:", putRes.data);

    console.log("\n4. Testing DELETE /qr-cashiers/:id...");
    const delRes = await axios.delete(`${baseUrl}/qr-cashiers/${newId}`);
    console.log("DELETE Response Status:", delRes.status);

  } catch (err) {
    console.error("Full error:", err);
  }
}

test();
