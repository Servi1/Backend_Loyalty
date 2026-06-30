const axios = require("axios");

async function test() {
  try {
    const res = await axios.delete("http://localhost:5001/api/upload", {
      data: { filePath: "/uploads/logos/1782825568027-4012282.jpg" }
    });
    console.log("Response:", res.data);
  } catch (err) {
    console.error("Error status:", err.response?.status);
    console.error("Error data:", err.response?.data);
  }
}

test();
