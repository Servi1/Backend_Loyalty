const { getAppImageURL } = require("../src/config");

console.log("=== Testing getAppImageURL ===");

const testCases = [
  { input: null, expected: null },
  { input: undefined, expected: undefined },
  { input: "", expected: "" },
  { input: "https://example.com/image.png", expected: "https://example.com/image.png" },
  { input: "http://example.com/image.png", expected: "http://example.com/image.png" },
  { input: "/uploads/menus/123.jpg", expected: "https://test2-api.servi.sa/uploads/menus/123.jpg" },
  { input: "uploads/menus/123.jpg", expected: "https://test2-api.servi.sa/uploads/menus/123.jpg" },
  { input: 12345, expected: 12345 },
  { input: { url: "/test" }, expected: { url: "/test" } },
];

let failed = false;
for (const tc of testCases) {
  const result = getAppImageURL(tc.input);
  const expectedStr = typeof tc.expected === "object" && tc.expected !== null ? JSON.stringify(tc.expected) : String(tc.expected);
  const resultStr = typeof result === "object" && result !== null ? JSON.stringify(result) : String(result);
  
  if (resultStr !== expectedStr) {
    console.error(`FAIL: For input "${JSON.stringify(tc.input)}", expected "${expectedStr}", got "${resultStr}"`);
    failed = true;
  } else {
    console.log(`PASS: "${JSON.stringify(tc.input)}" -> "${resultStr}"`);
  }
}

if (!failed) {
  console.log("\nALL TESTS PASSED!");
  process.exit(0);
} else {
  console.log("\nSOME TESTS FAILED.");
  process.exit(1);
}
