const mainPrisma = require("../../../config/prisma");
const firebaseConfig = require("../../../config/firebase");

/**
 * Send Broadcast Push Notification to target audience
 */
const sendBroadcastNotification = async ({
  title,
  body,
  imageUrl,
  targetAudience = "ALL",
  action = "OPEN_APP",
  sentBy = "Super Admin"
}) => {
  if (!title || !title.trim()) {
    throw new Error("Notification title is required");
  }
  if (!body || !body.trim()) {
    throw new Error("Notification body message is required");
  }

  const payloadData = {
    action: action || "OPEN_APP",
    targetAudience: targetAudience || "ALL"
  };

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
      data: payloadData
    });
  } catch (err) {
    console.error("[FCM TOPIC SEND WARNING]:", err.message);
  }

  // 2. Query stored FCM tokens from AppUser table based on targetAudience filter
  let userWhere = { fcmToken: { not: null } };
  if (targetAudience && targetAudience !== "ALL") {
    // If target audience specifies a tier, filter via wallet tier
    userWhere = {
      ...userWhere,
      wallet: {
        tier: { equals: targetAudience.toLowerCase(), mode: "insensitive" }
      }
    };
  }

  const usersWithToken = await mainPrisma.appUser.findMany({
    where: userWhere,
    select: { id: true, fcmToken: true }
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
          data: payloadData
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

  // 3. Save log to database
  const notificationRecord = await mainPrisma.broadcastNotification.create({
    data: {
      title: title.trim(),
      body: body.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : null,
      targetAudience: targetAudience || "ALL",
      dataPayload: payloadData,
      sentBy: sentBy || "Super Admin",
      sentCount,
      successCount,
      failureCount,
      status
    }
  });

  return notificationRecord;
};

/**
 * Get Broadcast History List
 */
const getBroadcastHistory = async () => {
  return await mainPrisma.broadcastNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });
};

/**
 * Delete a Broadcast Log item
 */
const deleteBroadcastHistory = async (id) => {
  return await mainPrisma.broadcastNotification.delete({
    where: { id }
  });
};

/**
 * Test Firebase Connection Status
 */
const getFirebaseStatus = async () => {
  const registeredTokensCount = await mainPrisma.appUser.count({
    where: { fcmToken: { not: null } }
  });

  return {
    initialized: firebaseConfig.firebaseInitialized,
    projectId: firebaseConfig.projectId,
    registeredTokensCount
  };
};

module.exports = {
  sendBroadcastNotification,
  getBroadcastHistory,
  deleteBroadcastHistory,
  getFirebaseStatus
};
