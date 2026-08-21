const express = require("express");
const { onboardZatcaSandbox, testZatcaCompliance, resyncOrdersZatca, reportInvoiceToZatcaSandbox } = require("./zatca.service");

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

// Resync Batch ZATCA Orders
zatcaRouter.post("/zatca/resync-orders", async (req, res, next) => {
  try {
    const { orderIds, branchId, zatcaStatusFilter } = req.body;
    const result = await resyncOrdersZatca(req.tenantDb, { orderIds, branchId, zatcaStatusFilter });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Resync Single ZATCA Order
zatcaRouter.post("/zatca/resync-order/:orderId", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const result = await reportInvoiceToZatcaSandbox(req.tenantDb, orderId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = zatcaRouter;
