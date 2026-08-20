const express = require("express");
const { onboardZatcaSandbox, testZatcaCompliance } = require("./zatca.service");

const zatcaRouter = express.Router({ mergeParams: true });

// Onboard Branch in ZATCA Sandbox (CSID generation)
zatcaRouter.post("/branches/:branchId/zatca/onboard", async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { vatNumber, crNumber, otp, environment } = req.body;
    const result = await onboardZatcaSandbox(req.tenantDb, branchId, { vatNumber, crNumber, otp, environment });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Run ZATCA Compliance Tests
zatcaRouter.post("/branches/:branchId/zatca/test-compliance", async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const result = await testZatcaCompliance(req.tenantDb, branchId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = zatcaRouter;
