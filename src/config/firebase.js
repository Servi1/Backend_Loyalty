const admin = require("firebase-admin");

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "servi-app-ecc4e",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "c1023540d17376a08df1970c3c302b0e518e055f",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDgqoqmczbTWjXs
t7pXAOOYAWzZsAdQj3tVsnBBzPGeD2YwZVuYt3XyFxjsHXs78og0TAKdB4iFcx4C
nrl8deL2dqv+qxIIjrmZ2fHUnpzWvR0WXlHJ5ID/cxAilypdbFe9aCXd9VzIbAzC
IOnFCohRAc2tQAtjR0Wjq3Vf2oNnLZrpn6Sw8qnmw+K5ACIJgcFagoMXd6mU89UN
RsbChuwLQLTb5wpc0pqKAsJ3cOg32mhmFqjyfEUMMXQfMb6EYJR+BAGEUbGYwsZs
lCiyIgvrcdceVKENtwK3qtDAIpzsnfRJ7QlgnBZPyTVqDb8eXsw8RDKlbg//9cvu
eseXT0PjAgMBAAECggEAIjUFQFu5hMuu+zhsOFQL0zigVLLPIk5+ZmlxWytzvG+2
zPaZ0hfghdfgdfgdfgOmLIPbHFbiEKBSmvBPPPoQKBgQC9
/fK+jqoTij+HgBsK9aGtLoekY/D56Bfg5/rjq8EAbSWyMxmTT3oCnCNLOOhvnO5b
J5/MY7/i0tEtnDfQUBbHSIBvYImZ0NX2el62zHzeh2qZm7hJoRkGanSuj3sDGo1x
Gm2AhTlibAGjgpC+KAsxnezwxbrlHgFCHQFAi6WtJQKBgQDaNHIG5278bN7MgxLY
MQx36WoYvEJ3zsQ6qWfiPiAETTeuUDaW8ObbJ2HVYleINyKsGz2FWlBFdDxa225v
Ew5IPvfv/fc3QKKjLJWybKoANt/jty8NcnCtwLUOcGykhZzjtwr7cm3a8kbpI8eZ
JUXFjyOfbpI0NoV+PTBhp20+kA==
-----END PRIVATE KEY-----`).replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@servi-app-ecc4e.iam.gserviceaccount.com",
  client_id: process.env.FIREBASE_CLIENT_ID || "107731308766370006152",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40servi-app-ecc4e.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};

let firebaseInitialized = false;

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log("[FIREBASE] Admin SDK initialized successfully for project:", serviceAccount.project_id);
  }
} catch (error) {
  console.error("[FIREBASE INITIALIZATION ERROR]:", error.message);
}

/**
 * Send FCM Push Notification to topic (e.g. "all_users")
 */
const sendTopicNotification = async ({ topic = "all_users", title, body, imageUrl, data = {} }) => {
  if (!admin.apps.length) {
    console.warn("[FIREBASE WARN] Firebase Admin SDK is not initialized. Notification logged locally.");
    return { messageId: `mock_msg_${Date.now()}` };
  }

  const message = {
    topic,
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {})
    },
    data: {
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      type: "BROADCAST",
      ...data
    },
    android: {
      notification: {
        sound: "default",
        priority: "high",
        channelId: "servi_broadcast_channel",
        ...(imageUrl ? { imageUrl } : {})
      }
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1
        }
      },
      fcmOptions: imageUrl ? { imageUrl } : undefined
    }
  };

  return await admin.messaging().send(message);
};

/**
 * Send FCM Push Notification to a list of tokens
 */
const sendMulticastNotification = async ({ tokens = [], title, body, imageUrl, data = {} }) => {
  if (!admin.apps.length) {
    console.warn("[FIREBASE WARN] Firebase Admin SDK is not initialized. Multicast notification logged locally.");
    return { successCount: tokens.length, failureCount: 0, responses: [] };
  }

  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const message = {
    tokens,
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {})
    },
    data: {
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      type: "BROADCAST",
      ...data
    },
    android: {
      notification: {
        sound: "default",
        priority: "high",
        channelId: "servi_broadcast_channel",
        ...(imageUrl ? { imageUrl } : {})
      }
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1
        }
      },
      fcmOptions: imageUrl ? { imageUrl } : undefined
    }
  };

  return await admin.messaging().sendEachForMulticast(message);
};

module.exports = {
  admin,
  firebaseInitialized,
  projectId: serviceAccount.project_id,
  sendTopicNotification,
  sendMulticastNotification
};
