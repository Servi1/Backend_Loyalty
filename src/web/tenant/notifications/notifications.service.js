const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");
const { sendEmailViaSMTP2GO, sendWhatsAppViaMeta } = require("../../../utils/notifications");

const getOrderWithCustomer = async (db, orderId) => {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { menuItem: true } } },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  // Load customer globally
  let customer = null;
  if (order.customerId) {
    customer = await mainPrisma.appUser.findUnique({ where: { id: order.customerId } });
  }

  return { order, customer };
};

const sendWhatsAppReminder = async (db, orderId) => {
  const { order, customer } = await getOrderWithCustomer(db, orderId);

  const phone = order.customerPhone || customer?.phone;
  if (!phone) {
    throw new ApiError(400, "Customer phone number is missing from this order");
  }

  const clientName = customer?.name || "Guest Client";
  const dateTimeStr = `${order.selectedSlotDate || "N/A"} at ${order.selectedSlot || "N/A"}`;
  const specialistName = order.staffName || "Assigned Specialist";

  return await sendWhatsAppViaMeta(phone, clientName, dateTimeStr, specialistName);
};

const sendEmailReminder = async (db, orderId) => {
  const { order, customer } = await getOrderWithCustomer(db, orderId);

  const email = customer?.email;
  if (!email) {
    throw new ApiError(400, "Customer email address is not registered");
  }

  const clientName = customer?.name || "Guest Client";
  const dateStr = order.selectedSlotDate || "N/A";
  const timeStr = order.selectedSlot || "N/A";
  const specialistName = order.staffName || "Assigned Specialist";
  const serviceName = order.items?.[0]?.menuItem?.name || "Scheduled Booking";

  const emailSubject = `Reminder: Your Appointment for ${serviceName}`;
  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded-lg">
      <h2 style="color: #6366f1;">Appointment Reminder</h2>
      <p>Hello ${clientName},</p>
      <p>This is a friendly reminder that you have a scheduled appointment coming up:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; width: 120px;">Service:</td>
          <td style="padding: 8px 0;">${serviceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Date:</td>
          <td style="padding: 8px 0;">${dateStr}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Time:</td>
          <td style="padding: 8px 0;">${timeStr}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Specialist:</td>
          <td style="padding: 8px 0;">${specialistName}</td>
        </tr>
      </table>
      <p>If you need to make changes or reschedule, please check your app or contact us directly.</p>
      <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #888888;">Thank you for booking with us!</p>
    </div>
  `;

  return await sendEmailViaSMTP2GO(email, emailSubject, emailHtml);
};

module.exports = {
  sendWhatsAppReminder,
  sendEmailReminder,
};
