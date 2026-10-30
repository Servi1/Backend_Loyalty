const service = require("../../web/admin/notifications/adminNotifications.service");

let intervalId = null;

function start() {
  console.log("⏰ [Scheduled Notifications Worker] Started (checking for due notifications every 30 seconds).");
  
  // Run initial check on startup
  service.processDueScheduledNotifications().catch((e) => {
    console.error("❌ [Scheduled Notifications Worker] Initial check error:", e.message);
  });

  // Check every 30 seconds
  intervalId = setInterval(() => {
    service.processDueScheduledNotifications().catch((e) => {
      console.error("❌ [Scheduled Notifications Worker] Check error:", e.message);
    });
  }, 30 * 1000);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  start,
  stop,
};

