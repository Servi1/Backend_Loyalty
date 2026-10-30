const mainPrisma = require("../../../config/prisma");
const firebaseConfig = require("../../../config/firebase");

/**
 * Core function that actually dispatches a broadcast notification via FCM.
 */
async function dispatchFCM({ title, body, imageUrl, targetAudience = "ALL", payloadData = {} }) {
  let sentCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let status = "SENT";

  // 1. Trigger FCM topic message to 'all_users' for instant global delivery
  try {
    await firebaseConfig.sendTopicNotification({
      topic: "all_users",
      title: title.trim(),
      body: body.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : undefined,
      data: payloadData,
    });
  } catch (err) {
    console.error("[FCM TOPIC SEND WARNING]:", err.message);
  }

  // 2. Query stored FCM tokens from AppUser table based on targetAudience filter
  let userWhere = { fcmToken: { not: null } };
  if (targetAudience && targetAudience !== "ALL") {
    userWhere = {
      ...userWhere,
      wallet: {
        tier: { equals: targetAudience.toLowerCase(), mode: "insensitive" },
      },
    };
  }

  const usersWithToken = await mainPrisma.appUser.findMany({
    where: userWhere,
    select: { id: true, fcmToken: true },
  });

  const tokens = Array.from(new Set(usersWithToken.map((u) => u.fcmToken).filter(Boolean)));
  sentCount = tokens.length;

  if (tokens.length > 0) {
    // Send in batches of 500 (FCM multicast limit)
    const BATCH_SIZE = 500;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batchTokens = tokens.slice(i, i + BATCH_SIZE);
      try {
        const batchResult = await firebaseConfig.sendMulticastNotification({
          tokens: batchTokens,
          title: title.trim(),
          body: body.trim(),
          imageUrl: imageUrl ? imageUrl.trim() : undefined,
          data: payloadData,
        });
        successCount += batchResult.successCount || 0;
        failureCount += batchResult.failureCount || 0;
      } catch (err) {
        console.error("[FCM MULTICAST BATCH ERROR]:", err.message);
        failureCount += batchTokens.length;
      }
    }
  } else {
    // No specific tokens stored yet; assume topic notification delivered to listeners
    successCount = 1;
  }

  if (failureCount > 0 && successCount > 0) status = "PARTIAL";
  if (failureCount > 0 && successCount === 0) status = "FAILED";

  return {
    sentCount,
    successCount,
    failureCount,
    status,
  };
}

/**
 * Send or Schedule Broadcast Push Notification
 */
const sendBroadcastNotification = async ({
  title,
  body,
  imageUrl,
  targetAudience = "ALL",
  action = "OPEN_APP",
  sentBy = "Super Admin",
  scheduledFor = null,
}) => {
  if (!title || !title.trim()) {
    throw new Error("Notification title is required");
  }
  if (!body || !body.trim()) {
    throw new Error("Notification body message is required");
  }

  const payloadData = {
    action: action || "OPEN_APP",
    targetAudience: targetAudience || "ALL",
  };

  // Case A: Schedule for a later time
  if (scheduledFor) {
    const scheduleDate = new Date(scheduledFor);
    if (isNaN(scheduleDate.getTime())) {
      throw new Error("Invalid schedule date format. Please choose a valid date and time.");
    }
    if (scheduleDate.getTime() <= Date.now()) {
      throw new Error("Scheduled time must be in the future.");
    }

    const scheduledRecord = await mainPrisma.broadcastNotification.create({
      data: {
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl ? imageUrl.trim() : null,
        targetAudience: targetAudience || "ALL",
        dataPayload: payloadData,
        sentBy: sentBy || "Super Admin",
        sentCount: 0,
        successCount: 0,
        failureCount: 0,
        status: "SCHEDULED",
        scheduledFor: scheduleDate,
      },
    });

    console.log(`⏰ [NOTIFICATION SCHEDULED] ID: ${scheduledRecord.id} | Scheduled for: ${scheduleDate.toISOString()}`);
    return scheduledRecord;
  }

  // Case B: Immediate delivery
  const dispatchResult = await dispatchFCM({
    title,
    body,
    imageUrl,
    targetAudience,
    payloadData,
  });

  const notificationRecord = await mainPrisma.broadcastNotification.create({
    data: {
      title: title.trim(),
      body: body.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : null,
      targetAudience: targetAudience || "ALL",
      dataPayload: payloadData,
      sentBy: sentBy || "Super Admin",
      sentCount: dispatchResult.sentCount,
      successCount: dispatchResult.successCount,
      failureCount: dispatchResult.failureCount,
      status: dispatchResult.status,
      scheduledFor: null,
    },
  });

  return notificationRecord;
};

/**
 * Background worker task: Process notifications that have reached their scheduled time
 */
const processDueScheduledNotifications = async () => {
  try {
    const now = new Date();
    const dueNotifications = await mainPrisma.broadcastNotification.findMany({
      where: {
        status: "SCHEDULED",
        scheduledFor: { lte: now },
      },
    });

    if (!dueNotifications || dueNotifications.length === 0) return;

    console.log(`🔔 [SCHEDULED NOTIFICATIONS] Processing ${dueNotifications.length} due notification(s)...`);

    for (const n of dueNotifications) {
      try {
        const payloadData = n.dataPayload || { action: "OPEN_APP", targetAudience: n.targetAudience || "ALL" };
        const dispatchResult = await dispatchFCM({
          title: n.title,
          body: n.body,
          imageUrl: n.imageUrl,
          targetAudience: n.targetAudience,
          payloadData,
        });

        await mainPrisma.broadcastNotification.update({
          where: { id: n.id },
          data: {
            status: dispatchResult.status,
            sentCount: dispatchResult.sentCount,
            successCount: dispatchResult.successCount,
            failureCount: dispatchResult.failureCount,
          },
        });

        console.log(`✅ [SCHEDULED NOTIFICATION DISPATCHED] "${n.title}" delivered with status: ${dispatchResult.status}`);
      } catch (itemErr) {
        console.error(`❌ [SCHEDULED NOTIFICATION FAILED] ID: ${n.id}:`, itemErr.message);
        await mainPrisma.broadcastNotification.update({
          where: { id: n.id },
          data: { status: "FAILED", failureCount: 1 },
        }).catch(() => null);
      }
    }
  } catch (error) {
    console.error("❌ [SCHEDULED NOTIFICATIONS BATCH ERROR]:", error.message);
  }
};

/**
 * Cancel a scheduled notification
 */
const cancelScheduledNotification = async (id) => {
  const existing = await mainPrisma.broadcastNotification.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Notification record not found");
  }
  if (existing.status !== "SCHEDULED") {
    throw new Error("Only pending scheduled notifications can be cancelled");
  }

  return await mainPrisma.broadcastNotification.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
};

/**
 * Get Broadcast History List
 */
const getBroadcastHistory = async () => {
  return await mainPrisma.broadcastNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
};

/**
 * Delete a Broadcast Log item
 */
const deleteBroadcastHistory = async (id) => {
  return await mainPrisma.broadcastNotification.delete({
    where: { id },
  });
};

/**
 * Send Single Device Test Notification
 */
const sendTestNotification = async ({
  titleEn,
  titleAr,
  bodyEn,
  bodyAr,
  phone,
  sentBy = "Super Admin",
}) => {
  const cleanPhone = phone ? phone.toString().replace(/\D/g, "") : "";
  if (!cleanPhone) {
    throw new Error("Phone number is required for test notification");
  }

  const title = titleEn || titleAr || "Test Notification 🔔";
  const body = bodyEn || bodyAr || "This is a test message for the notification system.";

  const user = await mainPrisma.appUser.findFirst({
    where: {
      phone: { contains: cleanPhone.slice(-9) },
    },
  });

  const payloadData = {
    titleEn: titleEn || "",
    titleAr: titleAr || "",
    bodyEn: bodyEn || "",
    bodyAr: bodyAr || "",
    isTest: "true",
  };

  if (user && user.fcmToken) {
    try {
      await firebaseConfig.sendMulticastNotification({
        tokens: [user.fcmToken],
        title,
        body,
        data: payloadData,
      });
    } catch (err) {
      console.error("[FCM TEST NOTIFICATION ERROR]:", err.message);
    }
  } else {
    console.log(`[TEST NOTIFICATION] Target phone ${cleanPhone} received test payload simulation.`);
  }

  return { phone: cleanPhone, delivered: !!(user && user.fcmToken) };
};

/**
 * Test Firebase Connection Status
 */
const getFirebaseStatus = async () => {
  const registeredTokensCount = await mainPrisma.appUser.count({
    where: { fcmToken: { not: null } },
  });

  return {
    initialized: firebaseConfig.firebaseInitialized,
    projectId: firebaseConfig.projectId,
    registeredTokensCount,
  };
};

module.exports = {
  sendBroadcastNotification,
  processDueScheduledNotifications,
  cancelScheduledNotification,
  sendTestNotification,
  getBroadcastHistory,
  deleteBroadcastHistory,
  getFirebaseStatus,
};
