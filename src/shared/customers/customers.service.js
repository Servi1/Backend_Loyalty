/**
 * Customers Service (Aggregated Registry)
 * 
 * In the rewired global main-database architecture,
 * customer synchronization is no longer required.
 * This file contains no-op stubs to avoid breaking existing imports.
 */

const syncToAggregatedCustomer = async () => {
  return Promise.resolve();
};

const syncAllTenantCustomers = async () => {
  return Promise.resolve();
};

module.exports = {
  syncToAggregatedCustomer,
  syncAllTenantCustomers,
};
