const mainPrisma = require("../src/config/prisma");
const axios = require("axios");

async function run() {
  try {
    // 1. Get a customer from the database
    const user = await mainPrisma.appUser.findFirst();
    if (!user) {
      console.log("No user found in the database.");
      return;
    }
    console.log(`Testing with user: ${user.name} (Phone: ${user.phone})`);

    const phone = user.phone;
    const baseUrl = "http://localhost:5000/api/app/servi";

    // 2. Request OTP
    console.log("\nSending OTP...");
    const otpRes = await axios.post(`${baseUrl}/auth/otp/send`, { phone });
    console.log("OTP Send Response:", otpRes.data);

    // 3. Verify OTP
    console.log("\nVerifying OTP...");
    const verifyRes = await axios.post(`${baseUrl}/auth/otp/verify`, { phone, code: "1111" });
    console.log("OTP Verify Response:", verifyRes.status === 200 ? "Success" : "Failed");
    const token = verifyRes.data.token;
    if (!token) {
      throw new Error("Did not receive authentication token");
    }

    const headers = { Authorization: `Bearer ${token}` };

    // 4. Clear Cart (clean state)
    console.log("\nClearing Cart via API...");
    const clearRes = await axios.post(`${baseUrl}/cart/clear`, {}, { headers });
    console.log("Clear Response:", clearRes.data);

    // 5. Add Cart Item
    console.log("\nAdding Cart Item via API...");
    const addRes = await axios.post(`${baseUrl}/cart`, {
      cartLineId: "servi:item-abc:Large:Red",
      brandId: "servi",
      itemId: "item-abc",
      name: "Truffle Pizza",
      price: 15.99,
      qty: 1,
      image: "https://images.unsplash.com/photo-1513104890138-7c749659a591",
      size: "Large",
      flavor: "Red"
    }, { headers });
    console.log("Add Response:", addRes.data);
    if (!addRes.data.success || addRes.data.data.length !== 1) {
      throw new Error("Add failed");
    }

    // 6. Get Cart
    console.log("\nGetting Cart via API...");
    let getRes = await axios.get(`${baseUrl}/cart`, { headers });
    console.log("Get Response:", getRes.data);

    // 7. Update Quantity
    console.log("\nUpdating Cart Item Qty via API...");
    const updateRes = await axios.patch(`${baseUrl}/cart/servi:item-abc:Large:Red`, { qty: 4 }, { headers });
    console.log("Update Qty Response:", updateRes.data);
    if (updateRes.data.data[0].qty !== 4) {
      throw new Error("Update quantity failed");
    }

    // 8. Delete Cart Item
    console.log("\nRemoving Cart Item via API...");
    const deleteRes = await axios.delete(`${baseUrl}/cart/servi:item-abc:Large:Red`, { headers });
    console.log("Delete Response:", deleteRes.data);
    if (deleteRes.data.data.length !== 0) {
      throw new Error("Delete failed");
    }

    console.log("\nALL API ENDPOINT TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("Test failed with error:", err.message);
    if (err.response) {
      console.error("Error Response Data:", err.response.data);
    }
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

run();
