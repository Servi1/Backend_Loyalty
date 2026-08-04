const config = require("../config");

/**
 * Send an email reminder using SMTP2GO HTTP API.
 * @param {string} recipient - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlBody - Email body in HTML format
 */
const sendEmailViaSMTP2GO = async (recipient, subject, htmlBody) => {
  const { apiKey, sender } = config.smtp2go;

  if (!apiKey) {
    console.log(`[SMTP2GO MOCK] Email to: ${recipient} | Subject: ${subject}`);
    return { success: true, message: "MOCK: SMTP2GO not configured" };
  }

  try {
    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        sender: sender,
        to: [recipient],
        subject: subject,
        html_body: htmlBody,
      }),
    });

    const data = await response.json();
    if (!response.ok || (data.data && data.data.error)) {
      throw new Error(data.data?.error || `HTTP error ${response.status}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error("SMTP2GO Dispatch Failed:", error.message);
    throw error;
  }
};

/**
 * Send a template-based WhatsApp message using Meta Cloud API.
 * @param {string} phone - Recipient phone number (including country code, e.g. +9665xxxxxxxx)
 * @param {string} customerName - Name of the client
 * @param {string} dateTimeStr - Formatted appointment date/time
 * @param {string} specialistName - Assigned staff/specialist name
 */
const sendWhatsAppViaMeta = async (phone, customerName, dateTimeStr, specialistName) => {
  const { token, phoneNumberId, templateName } = config.metaWhatsapp;

  if (!token || !phoneNumberId) {
    console.log(`[META WHATSAPP MOCK] Message to: ${phone} | Template: ${templateName} | BodyParams: [${customerName}, ${dateTimeStr}, ${specialistName}]`);
    return { success: true, message: "MOCK: Meta WhatsApp not configured" };
  }

  // Clean phone number (Meta requires numbers without leading + symbol)
  const cleanPhone = phone.replace("+", "").trim();

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: "en_US", // Or standard locale configured on Meta Template Manager
          },
          components: [
            {
              "type": "body",
              "parameters": [
                { "type": "text", "text": customerName },
                { "type": "text", "text": dateTimeStr },
                { "type": "text", "text": specialistName }
              ]
            }
          ]
        }
      }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `HTTP error ${response.status}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error("Meta WhatsApp API Dispatch Failed:", error.message);
    throw error;
  }
};

module.exports = {
  sendEmailViaSMTP2GO,
  sendWhatsAppViaMeta,
};
