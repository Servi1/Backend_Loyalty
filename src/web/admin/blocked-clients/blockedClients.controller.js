const blockedClientsService = require("./blockedClients.service");

/**
 * Get list of blocked clients with pagination and filters
 */
async function getBlockedClients(req, res, next) {
  try {
    const { search, type, status, page, limit } = req.query;
    const result = await blockedClientsService.getBlockedClients({
      search,
      type,
      status,
      page,
      limit,
    });
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Manually block an IP or MAC address
 */
async function blockClient(req, res, next) {
  try {
    const { identifier, type, reason, notes } = req.body;
    const result = await blockedClientsService.blockClient({
      identifier,
      type,
      reason: reason || "Manually blocked by administrator",
      notes,
    });
    res.status(201).json({
      success: true,
      message: "Client successfully added to blocked list",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Unblock / Allow a client
 */
async function unblockClient(req, res, next) {
  try {
    const { id } = req.params;
    const adminIdentifier = req.admin?.name || req.admin?.email || req.user?.name || req.user?.email || "Super Admin";
    const result = await blockedClientsService.unblockClient(id, adminIdentifier);
    res.json({
      success: true,
      message: "Client successfully unblocked and allowed access",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Re-block a client
 */
async function reblockClient(req, res, next) {
  try {
    const { id } = req.params;
    const adminIdentifier = req.admin?.name || req.admin?.email || req.user?.name || req.user?.email || "Super Admin";
    const result = await blockedClientsService.reblockClient(id, adminIdentifier);
    res.json({
      success: true,
      message: "Client has been re-blocked",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a blocked client record
 */
async function deleteBlockedClient(req, res, next) {
  try {
    const { id } = req.params;
    const result = await blockedClientsService.deleteBlockedClient(id);
    res.json({
      success: true,
      message: "Blocked client record removed",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBlockedClients,
  blockClient,
  unblockClient,
  reblockClient,
  deleteBlockedClient,
};

