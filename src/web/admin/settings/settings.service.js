const mainPrisma = require("../../../config/prisma");

const defaults = {
  marketEnabled: "true",
  maintenance_mode: "false",
  new_signups: "true",
  guest_checkout: "true",
  scheduled_orders: "false",
  auto_payout: "true",
  refund_enabled: "true",
  push_notifications: "true",
  email_marketing: "false",
  disabledCategories: "",
  platform_vat: "15.0"
};

const DEFAULT_PRIVACY_POLICY = `Privacy Policy
Last updated: September 2026

At Servi, we are committed to protecting your privacy and ensuring your personal information is handled in a safe and responsible manner.

1. Information We Collect
We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order history.

2. How We Use Your Information
We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and communicate loyalty rewards with you.

3. Loyalty & Rewards Program
Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet.

4. Information Sharing
We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing your contact details to brand store staff) or as required by law.

5. Data Security
We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, or disclosure.

6. Contact Us
If you have any questions or concerns about this Privacy Policy, please contact our support team at support@servi.com.`;

const DEFAULT_FAQ_LIST = [
  {
    id: "faq_1",
    question: "How do I earn loyalty points on my orders?",
    answer: "You automatically earn points on every completed order paid via cash, card, or digital payment methods according to your brand's earn rate and daily tier limit."
  },
  {
    id: "faq_2",
    question: "How can I redeem my accumulated loyalty points?",
    answer: "During checkout on mobile ordering or QR Table/Cashier ordering, choose 'Pay with Loyalty Points' if you have sufficient points balance in your wallet."
  },
  {
    id: "faq_3",
    question: "How do tier levels work (Starter, Bronze, Silver, Gold, Platinum)?",
    answer: "Tier levels are automatically assigned based on your total completed orders and cumulative spend value. Higher tiers unlock higher daily point caps and exclusive benefits."
  },
  {
    id: "faq_4",
    question: "What happens if an order is cancelled or refunded?",
    answer: "If an order is cancelled or refunded, any loyalty points awarded for that order will be automatically reversed from your wallet."
  }
];

const DEFAULT_POLICY_POINTS = [
  {
    id: "pol_1",
    title: "1. Information We Collect",
    content: "We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order transaction history to enable loyalty rewards."
  },
  {
    id: "pol_2",
    title: "2. How We Use Your Information",
    content: "We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and calculate loyalty tier rewards."
  },
  {
    id: "pol_3",
    title: "3. Loyalty & Rewards Program",
    content: "Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet with real-time audit logs."
  },
  {
    id: "pol_4",
    title: "4. Information Sharing & Third Parties",
    content: "We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing contact details to store staff) or as required by law."
  },
  {
    id: "pol_5",
    title: "5. Data Security & Storage",
    content: "We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, loss, or disclosure."
  },
  {
    id: "pol_6",
    title: "6. User Rights & Contact Us",
    content: "Users can request access to, correction of, or deletion of their personal data at any time by contacting support at support@servi.com."
  }
];

const convertPointsToText = (points) => {
  if (!Array.isArray(points) || points.length === 0) return DEFAULT_PRIVACY_POLICY;
  return points.map(p => `${p.title}\n${p.content}`).join("\n\n");
};

const convertToHtml = (str, policyPoints) => {
  if (Array.isArray(policyPoints) && policyPoints.length > 0) {
    return policyPoints
      .map(
        (p) => `<h3 style="color:#4f46e5; margin-top:1.5rem; margin-bottom:0.5rem; font-size:1.1rem; font-weight:700;">${p.title}</h3>
<p style="color:#374151; line-height:1.6; margin-bottom:1rem;">${p.content}</p>`
      )
      .join("");
  }
  if (!str) return "";
  if (str.includes("<p>") || str.includes("<h2>") || str.includes("<div>")) {
    return str;
  }
  return str
    .split("\n\n")
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return "";
      if (/^\d+\.|\bPrivacy Policy\b|\bTerms\b/i.test(trimmed) && trimmed.length < 60) {
        return `<h3 style="color:#4f46e5; margin-top:1.5rem; margin-bottom:0.5rem; font-size:1.1rem; font-weight:700;">${trimmed}</h3>`;
      }
      return `<p style="color:#374151; line-height:1.6; margin-bottom:1rem;">${trimmed}</p>`;
    })
    .join("");
};

const stripHtml = (html) => {
  if (!html) return "";
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
};

const getSettings = async () => {
  const settings = await mainPrisma.systemSetting.findMany();
  const settingsMap = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const result = [];
  for (const [key, defaultValue] of Object.entries(defaults)) {
    let value = settingsMap[key];
    if (value === undefined) {
      try {
        const created = await mainPrisma.systemSetting.create({
          data: { key, value: defaultValue }
        });
        value = created.value;
      } catch (err) {
        const found = await mainPrisma.systemSetting.findUnique({ where: { key } });
        value = found ? found.value : defaultValue;
      }
    }
    result.push({ key, value });
  }
  return result;
};

const updateSettings = async (configs) => {
  const updated = [];
  for (const item of configs) {
    const { key, value } = item;
    const stringValue = String(value);
    const record = await mainPrisma.systemSetting.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue }
    });
    updated.push(record);
  }
  return updated;
};

const getAppContent = async (hostUrl = "") => {
  const [privacyRecord, pointsRecord, pdfRecord, faqRecord] = await Promise.all([
    mainPrisma.systemSetting.findUnique({ where: { key: "privacy_policy" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "policy_points" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "privacy_policy_pdf" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "faq_list" } })
  ]);

  let policyPoints = DEFAULT_POLICY_POINTS;
  if (pointsRecord && pointsRecord.value) {
    try {
      const parsed = JSON.parse(pointsRecord.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        policyPoints = parsed;
      }
    } catch (e) {
      policyPoints = DEFAULT_POLICY_POINTS;
    }
  }

  let privacyPolicyRaw = privacyRecord ? privacyRecord.value : convertPointsToText(policyPoints);
  let faqList = DEFAULT_FAQ_LIST;

  if (faqRecord && faqRecord.value) {
    try {
      faqList = JSON.parse(faqRecord.value);
    } catch (e) {
      faqList = DEFAULT_FAQ_LIST;
    }
  }

  const html = convertToHtml(privacyPolicyRaw, policyPoints);
  const text = stripHtml(privacyPolicyRaw);
  const baseUrl = hostUrl.replace(/\/$/, "");

  let pdfUrl = baseUrl ? `${baseUrl}/privacy-policy` : "/privacy-policy";
  let pdfRelativePath = null;
  if (pdfRecord && pdfRecord.value) {
    pdfRelativePath = pdfRecord.value;
    pdfUrl = baseUrl ? `${baseUrl}/${pdfRecord.value.replace(/^\//, "")}` : `/${pdfRecord.value.replace(/^\//, "")}`;
  }

  return {
    type: "pdf",
    hasPdf: true,
    pdfUrl,
    customPdfUploaded: !!pdfRelativePath,
    pdfRelativePath,
    privacyPolicy: privacyPolicyRaw,
    policyPoints,
    content: privacyPolicyRaw,
    html,
    text,
    privacyPolicyUrl: baseUrl ? `${baseUrl}/privacy-policy` : "/privacy-policy",
    faqList
  };
};

const generatePrivacyPolicyPDF = (res, data) => {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="Privacy_Policy.pdf"');

  doc.pipe(res);

  const primaryColor = "#4f46e5"; // Indigo
  const darkColor = "#0f172a";    // Dark slate text
  const bodyColor = "#334155";    // Muted text

  // Header Banner
  doc.rect(40, 40, 515, 60).fill(primaryColor);
  doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold").text("SERVI PLATFORM", 55, 52);
  doc.fontSize(10).font("Helvetica").fillColor("#c7d2fe").text(`PRIVACY POLICY & TERMS  |  Last Updated: September 2026`, 55, 78);

  doc.y = 125;

  const points = data.policyPoints && data.policyPoints.length > 0 ? data.policyPoints : null;

  if (points) {
    points.forEach((pt, idx) => {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(primaryColor).text(pt.title || `Section ${idx + 1}`, {
        paragraphGap: 4
      });
      doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text(pt.content || "", {
        lineGap: 4,
        paragraphGap: 14
      });
    });
  } else if (data.privacyPolicy) {
    doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text(data.privacyPolicy, {
      lineGap: 4,
      paragraphGap: 10
    });
  }

  // Footer on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#94a3b8").text(
      `Servi Platform Privacy Policy  •  Page ${i + 1} of ${range.count}`,
      40,
      doc.page.height - 30,
      { align: "center", width: 515 }
    );
  }

  doc.end();
};

const savePrivacyPdf = async (relativePath, hostUrl = "") => {
  await mainPrisma.systemSetting.upsert({
    where: { key: "privacy_policy_pdf" },
    update: { value: relativePath },
    create: { key: "privacy_policy_pdf", value: relativePath }
  });
  return getAppContent(hostUrl);
};

const removePrivacyPdf = async (hostUrl = "") => {
  await mainPrisma.systemSetting.delete({
    where: { key: "privacy_policy_pdf" }
  }).catch(() => null);
  return getAppContent(hostUrl);
};

const updateAppContent = async ({ privacyPolicy, policyPoints, faqList }, hostUrl = "") => {
  const updates = [];

  if (policyPoints !== undefined) {
    const pointsString = typeof policyPoints === "string" ? policyPoints : JSON.stringify(policyPoints);
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "policy_points" },
        update: { value: pointsString },
        create: { key: "policy_points", value: pointsString }
      })
    );

    if (Array.isArray(policyPoints)) {
      const compiledText = convertPointsToText(policyPoints);
      updates.push(
        mainPrisma.systemSetting.upsert({
          where: { key: "privacy_policy" },
          update: { value: compiledText },
          create: { key: "privacy_policy", value: compiledText }
        })
      );
    }
  } else if (privacyPolicy !== undefined) {
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "privacy_policy" },
        update: { value: String(privacyPolicy) },
        create: { key: "privacy_policy", value: String(privacyPolicy) }
      })
    );
  }

  if (faqList !== undefined) {
    const faqString = typeof faqList === "string" ? faqList : JSON.stringify(faqList);
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "faq_list" },
        update: { value: faqString },
        create: { key: "faq_list", value: faqString }
      })
    );
  }

  await Promise.all(updates);
  return getAppContent(hostUrl);
};

module.exports = {
  getSettings,
  updateSettings,
  getAppContent,
  updateAppContent,
  savePrivacyPdf,
  removePrivacyPdf,
  generatePrivacyPolicyPDF,
  convertToHtml,
  stripHtml
};
