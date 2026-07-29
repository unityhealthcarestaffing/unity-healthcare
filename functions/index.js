/* eslint-disable */

const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

// ✅ v2 modular triggers
const {
  onDocumentCreated,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const {
  FieldValue,
  Timestamp,
} = require("firebase-admin/firestore");
const {
  createCallableAdminAuthorizer,
} = require("./adminAuthorization");

const callableAdminAuthorizer =
  createCallableAdminAuthorizer({
    admin,
    HttpsError,
  });

const REGION = "us-central1";
const ADMIN_EMAILS = defineString("ADMIN_EMAILS");

// Legacy config support (optional)
let legacyFunctions = null;
try {
  legacyFunctions = require("firebase-functions");
} catch (e) {
  legacyFunctions = null;
}

/**
 * ✅ SAFE CONFIG (supports BOTH):
 * A) firebase functions:config:set smtp.pass="..."
 * B) process.env.SMTP_PASS, etc
 */
function getSmtpConfig() {
  const cfg = legacyFunctions?.config?.()?.smtp || {};

  return {
    host: process.env.SMTP_HOST || cfg.host || "mail.privateemail.com",
    port: Number(process.env.SMTP_PORT || cfg.port || 465),
    secure:
      String(process.env.SMTP_SECURE || cfg.secure || "true").toLowerCase() ===
      "true",
    user:
      process.env.SMTP_USER ||
      cfg.user ||
      "info@unityhealthcarestaffing.co.uk",
    pass: process.env.SMTP_PASS || cfg.pass,
    to_enquiries:
      process.env.SMTP_TO_ENQUIRIES ||
      cfg.to_enquiries ||
      cfg.user ||
      "info@unityhealthcarestaffing.co.uk",
    to_staff:
      process.env.SMTP_TO_STAFF ||
      cfg.to_staff ||
      cfg.user ||
      "recruitment@unityhealthcarestaffing.co.uk",

    // ✅ Admin emails (for callable access)
    admin_emails:
      process.env.ADMIN_EMAILS ||
      cfg.admin_emails ||
      "info@unityhealthcarestaffing.co.uk,valentine@unityhealthcarestaffing.co.uk,valentine.c.enyi@gmail.com",
  };
}

function createTransporter() {
  const smtpConfig = getSmtpConfig();

  if (!smtpConfig.pass) {
    console.error(
      "SMTP password missing. Set it using either:\n" +
      "1) firebase functions:config:set smtp.pass='...'\n" +
      "OR\n" +
      "2) environment variable SMTP_PASS"
    );
  }

  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });
}

async function sendEmail(mailOptions) {
  const transporter = createTransporter();
  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent:", mailOptions.subject);
  } catch (err) {
    console.error("Error sending email:", err);
  }
}

/* ------------------------------------------------------------------ */
/* ✅ ADMIN HELPER (email list)                                        */
/* ------------------------------------------------------------------ */

function isAdminEmail(email) {
  const list = String(ADMIN_EMAILS.value() || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return (
    !!email &&
    list.includes(String(email).trim().toLowerCase())
  );
}

/* ------------------------------------------------------------------ */
/* ✅ SMALL SAFE HELPERS                                               */
/* ------------------------------------------------------------------ */

function safeString(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function looksLikePublicShiftId(s) {
  // Public shift code: SH-000001
  return /^SH-\d{6}$/i.test(String(s || "").trim());
}

/**
 * ✅ NON-BREAKING RESOLVER:
 * Your UI currently passes Firestore docId into callables (keeps working),
 * but now we ALSO accept public Shift IDs like "SH-000001".
 */
async function resolveShiftRefByDocIdOrPublicId(db, input) {
  const raw = safeString(input);
  if (!raw) return null;

  // If input is SH-000001, find the shift: where shiftId == that value.
  if (looksLikePublicShiftId(raw)) {
    const q = await db
      .collection("shifts")
      .where("shiftId", "==", raw.toUpperCase())
      .limit(1)
      .get();

    if (q.empty) return null;
    return q.docs[0].ref;
  }

  // Otherwise treat it as Firestore doc id
  return db.collection("shifts").doc(raw);
}

/* ------------------------------------------------------------------ */
/* ✅ STAFF 4-DIGIT ID ASSIGNMENT ON ONBOARDING (v2)                   */
/* ------------------------------------------------------------------ */

function pad4(n) {
  return String(n).padStart(4, "0");
}

exports.assignStaffIdOnOnboardingV2 = onDocumentUpdated(
  { document: "users/{uid}", region: REGION },
  async (event) => {
    try {
      const before = event.data?.before?.data?.() || {};
      const after = event.data?.after?.data?.() || {};
      const uid = event.params.uid;

      const wasOnboarded = before.onboardingCompleted === true;
      const isOnboarded = after.onboardingCompleted === true;

      if (wasOnboarded || !isOnboarded) return;

      if (
        (after.staffCode && String(after.staffCode).trim()) ||
        (after.publicId && String(after.publicId).trim())
      ) {
        return;
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);
      const counterRef = db.collection("staffCounters").doc("main");

      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) return;

        const userData = userSnap.data() || {};

        if (
          (userData.staffCode && String(userData.staffCode).trim()) ||
          (userData.publicId && String(userData.publicId).trim())
        ) {
          return;
        }

        let counterSnap = await tx.get(counterRef);

        if (!counterSnap.exists) {
          tx.set(counterRef, { next: 1000 }, { merge: true });
          counterSnap = await tx.get(counterRef);
        }

        const rawNext = counterSnap.data()?.next;
        let candidate = Number.isFinite(rawNext) ? rawNext : 1000;
        if (candidate < 1000) candidate = 1000;

        while (true) {
          if (candidate > 9999) {
            throw new Error("Staff ID pool exhausted (1000–9999).");
          }

          const code = pad4(candidate);
          const codeRef = db.collection("staffCodes").doc(code);
          const codeSnap = await tx.get(codeRef);

          if (!codeSnap.exists) {
            tx.set(codeRef, {
              code,
              uid,
              email: userData.email || null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            tx.set(
              userRef,
              {
                staffCode: code,
                publicId: code,
                staffIdAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
                staffIdAssignedBy: "system",
              },
              { merge: true }
            );

            tx.set(counterRef, { next: candidate + 1 }, { merge: true });

            console.log(`Assigned staffCode ${code} to user ${uid}`);
            break;
          }

          candidate += 1;
        }
      });
    } catch (err) {
      console.error("assignStaffIdOnOnboardingV2 error:", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* ✅ SHIFT ID AUTO-GENERATOR (v2)                                     */
/* Every new shift gets shiftId like: SH-000001                         */
/* Uses a counter: shiftCounters/main { next: 1 }                       */
/* ------------------------------------------------------------------ */

function pad6(n) {
  return String(n).padStart(6, "0");
}

async function allocateNextShiftIdTx(db, tx) {
  const counterRef = db.collection("shiftCounters").doc("main");
  let counterSnap = await tx.get(counterRef);

  if (!counterSnap.exists) {
    // first allocation -> SH-000001
    tx.set(counterRef, { next: 2 }, { merge: true });
    return { number: 1, shiftId: `SH-${pad6(1)}` };
  }

  const current = Number(counterSnap.data()?.next || 1);
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 1;

  const shiftId = `SH-${pad6(safeCurrent)}`;
  tx.set(counterRef, { next: safeCurrent + 1 }, { merge: true });

  return { number: safeCurrent, shiftId };
}

exports.assignShiftIdOnCreateV2 = onDocumentCreated(
  { document: "shifts/{docId}", region: REGION },
  async (event) => {
    try {
      const db = admin.firestore();
      const docId = event.params.docId;
      const ref = db.collection("shifts").doc(docId);

      const created = event.data?.data?.() || {};

      // If already has a shiftId, do nothing
      const existing =
        (created.shiftId && String(created.shiftId).trim()) ||
        (created.shiftID && String(created.shiftID).trim()) ||
        (created.publicId && String(created.publicId).trim());

      if (existing) return;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;

        const data = snap.data() || {};
        const already =
          (data.shiftId && String(data.shiftId).trim()) ||
          (data.shiftID && String(data.shiftID).trim()) ||
          (data.publicId && String(data.publicId).trim());
        if (already) return;

        const alloc = await allocateNextShiftIdTx(db, tx);

        tx.set(
          ref,
          {
            shiftId: alloc.shiftId,
            shiftIdNumber: alloc.number,

            // keep compatibility (some screens might display publicId)
            publicId: alloc.shiftId,

            shiftIdAssignedAt: FieldValue.serverTimestamp(),
            shiftIdAssignedBy: "system",
          },
          { merge: true }
        );
      });

      console.log(`ShiftId assigned to shifts/${docId}`);
    } catch (err) {
      console.error("assignShiftIdOnCreateV2 error:", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* ✅ ONE-TIME BACKFILL: Assign shiftId to old shifts missing it (v2)   */
/* Callable by admin only                                              */
/* ------------------------------------------------------------------ */

exports.backfillShiftIdsV2 = onCall({ region: REGION }, async (request) => {
  try {
    await callableAdminAuthorizer
      .requireProtected(request);

    const db = admin.firestore();

    const batchSizeRaw = request.data?.batchSize;
    const batchSize = Math.min(
      400,
      Math.max(
        1,
        Number.isFinite(Number(batchSizeRaw)) ? Number(batchSizeRaw) : 200
      )
    );

    // ✅ Prefer queryable "null" first (if your older docs used null)
    const snapNull = await db
      .collection("shifts")
      .where("shiftId", "==", null)
      .limit(batchSize)
      .get();

    const docs = snapNull.docs;
    let updated = 0;

    for (const d of docs) {
      const ref = d.ref;

      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return;

        const data = s.data() || {};

        const already =
          (data.shiftId && String(data.shiftId).trim()) ||
          (data.shiftID && String(data.shiftID).trim()) ||
          (data.publicId && String(data.publicId).trim());

        if (already) return;

        const alloc = await allocateNextShiftIdTx(db, tx);

        tx.set(
          ref,
          {
            shiftId: alloc.shiftId,
            shiftIdNumber: alloc.number,
            publicId: alloc.shiftId,
            shiftIdAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
            shiftIdAssignedBy: "backfill",
          },
          { merge: true }
        );
      });

      updated += 1;
    }

    return {
      ok: true,
      updated,
      lookedAt: docs.length,
      message: docs.length
        ? `Backfill completed for this batch: ${updated}/${docs.length}. Run again until 0 returned.`
        : "No shifts found (shiftId == null). If some old shifts have missing field (not null), use an admin script to scan & patch.",
    };
  } catch (err) {
    console.error("backfillShiftIdsV2 error:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", err.message || "Backfill failed.");
  }
});

/* ------------------------------------------------------------------ */
/* 📩 NEW ENQUIRY EMAIL (v2)                                           */
/* ------------------------------------------------------------------ */
exports.onNewEnquiryV2 = onDocumentCreated(
  { document: "enquiries/{docId}", region: REGION },
  async (event) => {
    const data = event.data?.data?.() || {};
    const smtpConfig = getSmtpConfig();

    const mailOptions = {
      from: `"Unity Healthcare Staffing" <${smtpConfig.user}>`,
      to: smtpConfig.to_enquiries || smtpConfig.user,
      subject: `New client enquiry from ${data.name || "Unknown"}`,
      text: `
New client enquiry received:

From: ${data.name || "-"}
Email: ${data.email || "-"}
Phone: ${data.phone || "-"}
Service/Organisation: ${data.serviceName || "-"}

Who they are: ${data.who || "-"}

Message:
${data.message || "-"}

Submitted at: ${new Date().toISOString()}
    `,
    };

    await sendEmail(mailOptions);
  }
);

/* ------------------------------------------------------------------ */
/* 📩 NEW STAFF APPLICATION EMAIL (v2)                                 */
/* ------------------------------------------------------------------ */
exports.onNewStaffApplicationV2 = onDocumentCreated(
  { document: "staffApplications/{docId}", region: REGION },
  async (event) => {
    const data = event.data?.data?.() || {};
    const smtpConfig = getSmtpConfig();

    const applicantName =
      data.name ||
      data.fullName ||
      `${data.otherNames || ""} ${data.surname || ""}`.trim() ||
      "Unknown";

    const role = data.role || data.roleApplied || "-";

    const mailOptions = {
      from: `"Unity Healthcare Staffing" <${smtpConfig.user}>`,
      to: smtpConfig.to_staff || smtpConfig.user,
      subject: `New staff application: ${applicantName}`,
      text: `
New staff application received:

Name: ${applicantName}
Email: ${data.email || "-"}
Phone: ${data.phone || "-"}
Role: ${role}
Experience (years): ${data.experienceYears || "-"}

Experience settings:
${data.settings || "-"}

DBS status: ${data.dbsStatus || "-"}

Availability:
${data.availability || "-"}

Submitted at: ${new Date().toISOString()}
    `,
    };

    await sendEmail(mailOptions);
  }
);
/* ------------------------------------------------------------------ */
/* ADMIN CREATES SHIFT ON BEHALF OF CLIENT (v2)                       */
/* ------------------------------------------------------------------ */

exports.adminCreateShiftV2 = onCall({ region: REGION }, async (request) => {
  try {
    const adminAccess =
      await callableAdminAuthorizer
        .load(request);

    const adminUid = request.auth.uid;
    const adminEmail =
      request.auth.token?.email || "";

    const clientId = safeString(request.data?.clientId);
    const dateInput = safeString(request.data?.date);
    const startTime = safeString(request.data?.startTime);
    const endTime = safeString(request.data?.endTime);
    const location = safeString(request.data?.location);
    const address = safeString(request.data?.address);
    const postcode = safeString(request.data?.postcode);
    const landmarks = safeString(request.data?.landmarks);
    const role = safeString(request.data?.role);

    const clientRateInput = request.data?.clientRate;
    const staffRateInput = request.data?.staffRate;
    const staffNeededInput = request.data?.staffNeeded;

    if (!clientId) {
      throw new HttpsError(
        "invalid-argument",
        "Please select a client."
      );
    }

    callableAdminAuthorizer
      .assertScoped(
        adminAccess,
        "shifts",
        "create",
        clientId
      );

    if (!dateInput) {
      throw new HttpsError(
        "invalid-argument",
        "Shift date is required."
      );
    }

    if (!startTime || !endTime) {
      throw new HttpsError(
        "invalid-argument",
        "Start time and end time are required."
      );
    }

    if (!location) {
      throw new HttpsError(
        "invalid-argument",
        "Shift location is required."
      );
    }

    if (!role) {
      throw new HttpsError(
        "invalid-argument",
        "Shift role is required."
      );
    }

    const dateMatch = dateInput.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!dateMatch) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid shift date."
      );
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);

    const shiftDate = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0)
    );

    if (Number.isNaN(shiftDate.getTime())) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid shift date."
      );
    }

    const today = new Date();
    const todayUtc = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
      )
    );

    if (shiftDate.getTime() < todayUtc.getTime()) {
      throw new HttpsError(
        "failed-precondition",
        "Shift date cannot be in the past."
      );
    }

    const clientRate =
      clientRateInput === "" ||
        clientRateInput === null ||
        clientRateInput === undefined
        ? null
        : Number(clientRateInput);

    const staffRate =
      staffRateInput === "" ||
        staffRateInput === null ||
        staffRateInput === undefined
        ? null
        : Number(staffRateInput);

    if (
      clientRate !== null &&
      (!Number.isFinite(clientRate) || clientRate < 0)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Client rate must be a valid number."
      );
    }

    if (
      staffRate !== null &&
      (!Number.isFinite(staffRate) || staffRate < 0)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Staff rate must be a valid number."
      );
    }

    const staffNeeded = Math.min(
      50,
      Math.max(
        1,
        Number.isFinite(Number(staffNeededInput))
          ? Math.floor(Number(staffNeededInput))
          : 1
      )
    );

    const db = admin.firestore();

    const clientRef = db.collection("clients").doc(clientId);
    const clientSnap = await clientRef.get();

    if (!clientSnap.exists) {
      throw new HttpsError(
        "not-found",
        "The selected client could not be found."
      );
    }

    const client = clientSnap.data() || {};

    const clientStatus = safeString(client.status).toLowerCase();

    const clientIsActive =
      client.isActive === true ||
      clientStatus === "active";

    if (!clientIsActive) {
      throw new HttpsError(
        "failed-precondition",
        "Only active clients can have shifts created for them."
      );
    }

    const clientOrganisation =
      client.organisationName ||
      client.organizationName ||
      client.companyName ||
      client.businessName ||
      client.name ||
      null;

    const clientName =
      client.contact?.name ||
      client.contactName ||
      client.primaryContactName ||
      client.contactPerson ||
      client.fullName ||
      client.displayName ||
      client.name ||
      null;

    const clientEmail =
      client.contact?.email ||
      client.contactEmail ||
      client.email ||
      null;

    const clientPublicId =
      safeString(
        client.clientCode ||
        client.clientPublicId ||
        client.publicId ||
        client.publicID ||
        client.code
      ) || null;

    const clientGroupId =
      `ADMIN-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;

    const batch = db.batch();
    const createdShiftIds = [];

    for (let index = 0; index < staffNeeded; index += 1) {
      const shiftRef = db.collection("shifts").doc();
      createdShiftIds.push(shiftRef.id);

      batch.set(shiftRef, {
        clientId,
        clientEmail,
        clientOrganisation,
        clientName,
        clientPublicId,

        date: admin.firestore.Timestamp.fromDate(shiftDate),
        startTime,
        endTime,
        role,

        location,
        address: address || null,
        postcode: postcode || null,
        landmarks: landmarks || null,

        status: "open",

        rates: {
          client: clientRate,
          staff: staffRate,
        },

        hourlyRate: staffRate,
        staffRate,
        clientRate,
        billingRate: clientRate,
        clientHourlyRate: clientRate,

        clientGroupId,

        // Each Firestore shift document represents one staff slot.
        staffNeeded: 1,

        // Preserve the client's original request for reporting.
        staffNeededRequested: staffNeeded,
        requestedStaffCount: staffNeeded,
        staffNeededGroupKey: clientGroupId,
        staffNeededSlotIndex: index + 1,

        slotNumber: index + 1,

        createdBy: adminUid,
        createdByUid: adminUid,
        createdByRole: "admin",
        createdByAdminId: adminUid,
        createdByAdminEmail: adminEmail,
        adminCreated: true,

        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    return {
      ok: true,
      message:
        staffNeeded === 1
          ? "Shift created successfully."
          : `${staffNeeded} shift slots created successfully.`,
      createdShiftIds,
      clientGroupId,
    };
  } catch (err) {
    console.error("adminCreateShiftV2 error:", err);

    if (err instanceof HttpsError) {
      throw err;
    }

    throw new HttpsError(
      "internal",
      err?.message || "Could not create the shift."
    );
  }
});
/* ------------------------------------------------------------------ */
/* ADMIN DIRECTLY ASSIGNS AN OPEN SHIFT TO STAFF (v2)                 */
/* ------------------------------------------------------------------ */

function adminAssignNormalizeRole(raw) {
  const value = safeString(raw).toLowerCase();

  if (!value) return "";

  if (
    value.includes("healthcare assistant") ||
    value === "hca"
  ) {
    return "hca";
  }

  if (value.includes("support worker")) {
    return "support worker";
  }

  if (
    value === "rgn" ||
    value.includes("registered general nurse")
  ) {
    return "rgn";
  }

  if (
    value === "rmn" ||
    value.includes("registered mental health nurse")
  ) {
    return "rmn";
  }

  if (value.includes("nurse")) {
    return "nurse";
  }

  return value;
}

function adminAssignStaffCanCover(staffRoleRaw, shiftRoleRaw) {
  const staffRole = adminAssignNormalizeRole(staffRoleRaw);
  const shiftRole = adminAssignNormalizeRole(shiftRoleRaw);

  // Preserve support for older staff profiles without a working-role field.
  if (!staffRole) return true;

  if (
    staffRole === "hca" ||
    staffRole === "support worker"
  ) {
    return (
      shiftRole === "hca" ||
      shiftRole === "support worker"
    );
  }

  if (staffRole === "nurse") {
    return (
      shiftRole === "nurse" ||
      shiftRole === "rgn" ||
      shiftRole === "rmn"
    );
  }

  return staffRole === shiftRole;
}

function adminAssignReadMaxWeeklyHours(profile) {
  const value =
    profile?.maxWeeklyHours ??
    profile?.maxHoursPerWeek ??
    profile?.weeklyMaxHours ??
    profile?.weeklyHoursLimit ??
    profile?.visaWeeklyHoursLimit ??
    null;

  const number =
    typeof value === "number"
      ? value
      : value === null ||
        value === undefined ||
        value === ""
        ? null
        : Number(String(value).trim());

  return (
    typeof number === "number" &&
      Number.isFinite(number) &&
      number > 0
      ? number
      : null
  );
}

function adminAssignParseTime(value) {
  const match = safeString(value).match(
    /^(\d{1,2}):(\d{2})$/
  );

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return { hour, minute };
}

function adminAssignToDate(value) {
  try {
    if (
      value?.toDate &&
      typeof value.toDate === "function"
    ) {
      return value.toDate();
    }

    if (value instanceof Date) {
      return value;
    }

    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }

    return null;
  } catch {
    return null;
  }
}

const adminAssignUKFormatter = new Intl.DateTimeFormat(
  "en-GB",
  {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }
);

function adminAssignGetUKParts(date) {
  if (!date) return null;

  const values = {};

  for (const part of adminAssignUKFormatter.formatToParts(
    date
  )) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  if (
    !Number.isFinite(values.year) ||
    !Number.isFinite(values.month) ||
    !Number.isFinite(values.day)
  ) {
    return null;
  }

  return values;
}

/*
 * These are nominal UK wall-clock Date objects.
 * They allow reliable comparisons between shift calendar dates and times.
 */
function adminAssignBuildShiftStart(shift) {
  const storedDate = adminAssignToDate(shift?.date);
  const dateParts = adminAssignGetUKParts(storedDate);
  const timeParts = adminAssignParseTime(shift?.startTime);

  if (!dateParts || !timeParts) return null;

  return new Date(
    Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      0,
      0
    )
  );
}

function adminAssignBuildShiftEnd(shift) {
  const storedDate = adminAssignToDate(shift?.date);
  const dateParts = adminAssignGetUKParts(storedDate);
  const timeParts = adminAssignParseTime(shift?.endTime);

  if (!dateParts || !timeParts) return null;

  const end = new Date(
    Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      0,
      0
    )
  );

  const start = adminAssignBuildShiftStart(shift);

  // Supports overnight shifts.
  if (start && end.getTime() <= start.getTime()) {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return end;
}

function adminAssignUKNow() {
  const parts = adminAssignGetUKParts(new Date());

  if (!parts) return new Date();

  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0,
      0
    )
  );
}

function adminAssignHoursBetween(start, end) {
  if (!start || !end) return null;

  return (
    (end.getTime() - start.getTime()) /
    (1000 * 60 * 60)
  );
}

function adminAssignDurationHours(shift) {
  const start = adminAssignBuildShiftStart(shift);
  const end = adminAssignBuildShiftEnd(shift);
  const hours = adminAssignHoursBetween(start, end);

  return hours !== null && hours > 0
    ? hours
    : 0;
}

function adminAssignIntervalsOverlap(
  firstStart,
  firstEnd,
  secondStart,
  secondEnd
) {
  if (
    !firstStart ||
    !firstEnd ||
    !secondStart ||
    !secondEnd
  ) {
    return false;
  }

  return (
    firstStart.getTime() < secondEnd.getTime() &&
    firstEnd.getTime() > secondStart.getTime()
  );
}

function adminAssignRestHours(
  candidateStart,
  candidateEnd,
  otherStart,
  otherEnd
) {
  if (
    !candidateStart ||
    !candidateEnd ||
    !otherStart ||
    !otherEnd
  ) {
    return null;
  }

  if (
    adminAssignIntervalsOverlap(
      candidateStart,
      candidateEnd,
      otherStart,
      otherEnd
    )
  ) {
    return 0;
  }

  if (
    candidateStart.getTime() >= otherEnd.getTime()
  ) {
    return adminAssignHoursBetween(
      otherEnd,
      candidateStart
    );
  }

  if (
    otherStart.getTime() >= candidateEnd.getTime()
  ) {
    return adminAssignHoursBetween(
      candidateEnd,
      otherStart
    );
  }

  return null;
}

function adminAssignWeekStartMonday(date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);

  const day = result.getUTCDay();
  const difference = day === 0 ? -6 : 1 - day;

  result.setUTCDate(
    result.getUTCDate() + difference
  );

  return result;
}

function adminAssignIsSameWeek(firstDate, secondDate) {
  return (
    adminAssignWeekStartMonday(firstDate).getTime() ===
    adminAssignWeekStartMonday(secondDate).getTime()
  );
}

exports.adminAssignShiftV2 = onCall(
  { region: REGION },
  async (request) => {
    try {
      const adminAccess =
        await callableAdminAuthorizer
          .load(request);

      const adminUid = request.auth.uid;
      const adminEmail =
        request.auth.token?.email || "";

      const shiftIdInput = safeString(
        request.data?.shiftId
      );

      const staffId = safeString(
        request.data?.staffId
      );

      if (!shiftIdInput) {
        throw new HttpsError(
          "invalid-argument",
          "Please select a shift."
        );
      }

      if (!staffId) {
        throw new HttpsError(
          "invalid-argument",
          "Please select a staff member."
        );
      }

      const db = admin.firestore();

      const shiftRef =
        await resolveShiftRefByDocIdOrPublicId(
          db,
          shiftIdInput
        );

      if (!shiftRef) {
        throw new HttpsError(
          "not-found",
          "The shift could not be found."
        );
      }

      const staffRef = db
        .collection("users")
        .doc(staffId);

      const result = await db.runTransaction(
        async (transaction) => {
          const shiftSnapshot =
            await transaction.get(shiftRef);

          const staffSnapshot =
            await transaction.get(staffRef);

          if (!shiftSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "The shift could not be found."
            );
          }

          if (!staffSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "The selected staff member could not be found."
            );
          }

          const shift =
            shiftSnapshot.data() || {};

          const profile =
            staffSnapshot.data() || {};

          const shiftClientId =
            safeString(
              shift.clientId ||
                shift.clientUid ||
                shift.clientUserId
            );

          callableAdminAuthorizer
            .assertScoped(
              adminAccess,
              "shifts",
              "assign",
              shiftClientId
            );

          const shiftStatus = safeString(
            shift.status
          ).toLowerCase();

          if (shiftStatus !== "open") {
            throw new HttpsError(
              "failed-precondition",
              "This shift is no longer open."
            );
          }

          const profileStatus = safeString(
            profile.status ||
            profile.accountStatus
          ).toLowerCase();

          const isActive =
            profile.isActive === true ||
            profileStatus === "active" ||
            profileStatus === "approved" ||
            profileStatus === "enabled";

          const accountRole = safeString(
            profile.role ||
            profile.accountType
          ).toLowerCase();

          const isStaffAccount =
            accountRole === "staff" ||
            profile.isStaff === true ||
            accountRole === "" ||
            accountRole === "user";

          const isOnboarded =
            profile.onboardingCompleted === true ||
            profile.onboarded === true;

          if (
            !isActive ||
            !isStaffAccount ||
            !isOnboarded
          ) {
            throw new HttpsError(
              "failed-precondition",
              "Only active and fully onboarded staff can be assigned."
            );
          }

          const staffWorkingRole =
            profile.staffRole ||
            profile.roleName ||
            profile.position ||
            profile.jobRole ||
            profile.primaryRole ||
            profile.roleType ||
            (
              accountRole !== "staff" &&
                accountRole !== "user"
                ? profile.role
                : ""
            ) ||
            "";

          if (
            !adminAssignStaffCanCover(
              staffWorkingRole,
              shift.role
            )
          ) {
            throw new HttpsError(
              "failed-precondition",
              "The selected staff member's role does not match this shift."
            );
          }

          const candidateStart =
            adminAssignBuildShiftStart(shift);

          const candidateEnd =
            adminAssignBuildShiftEnd(shift);

          if (!candidateStart || !candidateEnd) {
            throw new HttpsError(
              "failed-precondition",
              "The shift date or time is invalid."
            );
          }

          if (
            candidateStart.getTime() <
            adminAssignUKNow().getTime()
          ) {
            throw new HttpsError(
              "failed-precondition",
              "A staff member cannot be assigned to a shift in the past."
            );
          }

          const bookedQuery = db
            .collection("shifts")
            .where(
              "bookedStaffId",
              "==",
              staffId
            );

          const requestedQuery = db
            .collection("shifts")
            .where(
              "requestedStaffId",
              "==",
              staffId
            );

          const bookedSnapshot =
            await transaction.get(bookedQuery);

          const requestedSnapshot =
            await transaction.get(requestedQuery);

          const assignedShiftMap = new Map();

          for (const document of bookedSnapshot.docs) {
            assignedShiftMap.set(document.id, {
              id: document.id,
              ...document.data(),
            });
          }

          for (
            const document of requestedSnapshot.docs
          ) {
            assignedShiftMap.set(document.id, {
              id: document.id,
              ...document.data(),
            });
          }

          const blockingStatuses = new Set([
            "pending_admin",
            "pending_admin_booking",
            "booked",
            "completed",
          ]);

          const otherAssignedShifts = Array.from(
            assignedShiftMap.values()
          ).filter((otherShift) => {
            if (otherShift.id === shiftRef.id) {
              return false;
            }

            return blockingStatuses.has(
              safeString(
                otherShift.status
              ).toLowerCase()
            );
          });

          for (
            const otherShift of otherAssignedShifts
          ) {
            const otherStart =
              adminAssignBuildShiftStart(
                otherShift
              );

            const otherEnd =
              adminAssignBuildShiftEnd(
                otherShift
              );

            if (!otherStart || !otherEnd) {
              continue;
            }

            if (
              adminAssignIntervalsOverlap(
                candidateStart,
                candidateEnd,
                otherStart,
                otherEnd
              )
            ) {
              throw new HttpsError(
                "failed-precondition",
                "The selected staff member already has a shift that overlaps with this time."
              );
            }
          }

          const minimumRestHours = 10;

          for (
            const otherShift of otherAssignedShifts
          ) {
            const otherStart =
              adminAssignBuildShiftStart(
                otherShift
              );

            const otherEnd =
              adminAssignBuildShiftEnd(
                otherShift
              );

            if (!otherStart || !otherEnd) {
              continue;
            }

            const restHours =
              adminAssignRestHours(
                candidateStart,
                candidateEnd,
                otherStart,
                otherEnd
              );

            if (
              restHours !== null &&
              restHours < minimumRestHours
            ) {
              throw new HttpsError(
                "failed-precondition",
                "The selected staff member must have at least 10 hours' rest between shifts."
              );
            }
          }

          const maxWeeklyHours =
            adminAssignReadMaxWeeklyHours(
              profile
            );

          if (
            typeof maxWeeklyHours === "number"
          ) {
            const candidateHours =
              adminAssignDurationHours(shift);

            const currentWeeklyHours =
              otherAssignedShifts.reduce(
                (total, otherShift) => {
                  const otherStart =
                    adminAssignBuildShiftStart(
                      otherShift
                    );

                  if (
                    !otherStart ||
                    !adminAssignIsSameWeek(
                      otherStart,
                      candidateStart
                    )
                  ) {
                    return total;
                  }

                  return (
                    total +
                    adminAssignDurationHours(
                      otherShift
                    )
                  );
                },
                0
              );

            const projectedWeeklyHours =
              currentWeeklyHours +
              candidateHours;

            if (
              projectedWeeklyHours >
              maxWeeklyHours + 1e-9
            ) {
              throw new HttpsError(
                "failed-precondition",
                `Weekly hours limit exceeded. Maximum: ${maxWeeklyHours} hours. Assignment would result in ${projectedWeeklyHours.toFixed(
                  2
                )} hours.`
              );
            }
          }

          const staffEmail =
            profile.email || null;

          const staffOtherNames = safeString(
            profile.otherNames
          );

          const staffSurname = safeString(
            profile.surname
          );

          const staffName =
            safeString(profile.fullName) ||
            [
              staffOtherNames,
              staffSurname,
            ]
              .filter(Boolean)
              .join(" ") ||
            safeString(profile.name) ||
            safeString(profile.displayName) ||
            (
              staffEmail
                ? String(staffEmail).split("@")[0]
                : ""
            ) ||
            "Staff";

          const staffFirstName =
            staffOtherNames
              .split(/\s+/)
              .filter(Boolean)[0] ||
            safeString(profile.firstName) ||
            staffName
              .split(/\s+/)
              .filter(Boolean)[0] ||
            "Staff";

          const staffPublicId =
            safeString(
              profile.publicId ||
              profile.publicID ||
              profile.staffCode ||
              profile.code
            ) || null;

          transaction.update(shiftRef, {
            status: "booked",

            requestedStaffId: null,
            requestedStaffEmail: null,
            requestedStaffName: null,
            requestedStaffPublicId: null,

            bookedStaffId: staffId,
            bookedStaffEmail: staffEmail,
            bookedStaffName: staffName,
            bookedStaffFirstName: staffFirstName,
            assignedStaffFirstName: staffFirstName,
            bookedStaffOtherNames:
              staffOtherNames || null,
            bookedStaffSurname:
              staffSurname || null,
            bookedStaffPublicId:
              staffPublicId,

            assignmentMethod: "admin_direct",
            assignedDirectlyByAdmin: true,

            assignedByAdminId: adminUid,
            assignedByAdminEmail:
              adminEmail || null,
            assignedAt:
              admin.firestore.FieldValue.serverTimestamp(),

            approvedByAdminId: adminUid,
            approvedByAdminEmail:
              adminEmail || null,
            approvedAt:
              admin.firestore.FieldValue.serverTimestamp(),

            updatedByAdminId: adminUid,
            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });

          return {
            staffName,
            staffPublicId,
            shiftDocumentId: shiftRef.id,
          };
        }
      );

      return {
        ok: true,
        message: `${result.staffName} has been assigned to the shift.`,
        staffName: result.staffName,
        staffPublicId:
          result.staffPublicId,
        shiftDocumentId:
          result.shiftDocumentId,
      };
    } catch (err) {
      console.error(
        "adminAssignShiftV2 error:",
        err
      );

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError(
        "internal",
        err?.message ||
        "Could not assign the staff member."
      );
    }
  }
);
/* ------------------------------------------------------------------ */
/* ✅ Callable: staff requests to book a shift (v2)                     */
/* ------------------------------------------------------------------ */
exports.requestShiftBookingV2 = onCall({ region: REGION }, async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      return { ok: false, message: "You must be logged in to book a shift." };
    }

    const uid = request.auth.uid;
    const email = request.auth.token?.email || null;

    const shiftIdInput = request.data?.shiftId
      ? String(request.data.shiftId).trim()
      : "";
    if (!shiftIdInput) {
      return { ok: false, message: "Missing shiftId." };
    }

    const db = admin.firestore();

    // ✅ supports both Firestore docId and SH-000001
    const shiftRef = await resolveShiftRefByDocIdOrPublicId(db, shiftIdInput);
    if (!shiftRef) return { ok: false, message: "Shift not found." };

    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const shiftSnap = await tx.get(shiftRef);
      if (!shiftSnap.exists) {
        throw new HttpsError("not-found", "Shift not found.");
      }

      const shift = shiftSnap.data() || {};
      const status = String(shift.status || "").toLowerCase();
      if (status !== "open") {
        throw new HttpsError(
          "failed-precondition",
          "This shift is not available to book."
        );
      }

      const userSnap = await tx.get(userRef);
      const profile = userSnap.exists ? userSnap.data() : null;

      const pStatus = String(
        profile?.status || profile?.accountStatus || ""
      ).toLowerCase();
      const active =
        profile?.isActive === true ||
        pStatus === "active" ||
        pStatus === "approved" ||
        pStatus === "enabled";

      const role = String(
        profile?.role || profile?.accountType || ""
      ).toLowerCase();
      const staffish = role === "staff" || profile?.isStaff === true;

      const onboarded =
        profile?.onboardingCompleted === true || profile?.onboarded === true;

      const roleOk = staffish || role === "" || role === "user";
      if (!(active && onboarded && roleOk)) {
        throw new HttpsError(
          "permission-denied",
          "Only active staff can book shifts. Please contact admin."
        );
      }

      const staffPublicId =
        String(
          profile?.publicId ||
          profile?.publicID ||
          profile?.staffCode ||
          profile?.code ||
          ""
        ).trim() || null;

      const staffOtherNames = safeString(
        profile?.otherNames
      );

      const staffSurname = safeString(
        profile?.surname
      );

      const staffName =
        safeString(profile?.fullName) ||
        [
          staffOtherNames,
          staffSurname,
        ]
          .filter(Boolean)
          .join(" ") ||
        safeString(profile?.name) ||
        safeString(profile?.displayName) ||
        (
          email
            ? String(email).split("@")[0]
            : ""
        ) ||
        "Staff";

      const staffFirstName =
        staffOtherNames
          .split(/\s+/)
          .filter(Boolean)[0] ||
        safeString(profile?.firstName) ||
        staffName
          .split(/\s+/)
          .filter(Boolean)[0] ||
        "Staff";

      tx.update(shiftRef, {
        status: "pending_admin",

        requestedStaffId: uid,
        requestedStaffEmail: email,
        requestedStaffName: staffName,
        requestedStaffFirstName:
          staffFirstName,
        requestedStaffPublicId: staffPublicId,

        bookedStaffId: uid,
        bookedStaffEmail: email,
        bookedStaffName: staffName,
        bookedStaffFirstName:
          staffFirstName,
        bookedStaffOtherNames:
          staffOtherNames || null,
        bookedStaffSurname:
          staffSurname || null,
        bookedStaffPublicId: staffPublicId,

        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  } catch (err) {
    console.error("requestShiftBookingV2 error:", err);

    if (err instanceof HttpsError) {
      return { ok: false, message: err.message };
    }

    return {
      ok: false,
      message: err.message || "Booking failed. Please try again.",
    };
  }
});
/* ------------------------------------------------------------------ */
/* ✅ Callable: staff cancels their own booked shift                    */
/* - Keeps Firestore rules strict                                      */
/* - Confirms the booking belongs to the logged-in staff member        */
/* - Enforces the 48-hour cancellation rule on the server              */
/* - Reopens the shift safely in a transaction                         */
/* ------------------------------------------------------------------ */
exports.cancelShiftBookingV2 = onCall(
  { region: REGION },
  async (request) => {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "You must be logged in to cancel a booking."
        );
      }

      const staffUid = request.auth.uid;
      const staffEmail =
        request.auth.token?.email
          ? String(request.auth.token.email).trim().toLowerCase()
          : "";

      const shiftIdInput = String(
        request.data?.shiftId || ""
      ).trim();

      if (!shiftIdInput) {
        throw new HttpsError(
          "invalid-argument",
          "Missing shift ID."
        );
      }

      const db = admin.firestore();

      // First try the Firestore document ID.
      let shiftRef = db
        .collection("shifts")
        .doc(shiftIdInput);

      let shiftSnapshot = await shiftRef.get();

      // Also support public shift codes such as SH-000019.
      if (!shiftSnapshot.exists) {
        const publicIdQuery = await db
          .collection("shifts")
          .where("shiftId", "==", shiftIdInput)
          .limit(1)
          .get();

        if (publicIdQuery.empty) {
          throw new HttpsError(
            "not-found",
            "The shift could not be found."
          );
        }

        shiftRef = publicIdQuery.docs[0].ref;
      }

      const result = await db.runTransaction(
        async (transaction) => {
          const freshSnapshot =
            await transaction.get(shiftRef);

          if (!freshSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "The shift could not be found."
            );
          }

          const shift = freshSnapshot.data() || {};

          const bookingStaffIds = [
            shift.bookedStaffId,
            shift.requestedStaffId,
            shift.bookedBy,
            shift.staffBookedBy,
            shift.staffBooking?.staffId,
            shift.staffBooking?.uid,
          ]
            .filter(Boolean)
            .map((value) => String(value).trim());

          const bookingStaffEmails = [
            shift.bookedStaffEmail,
            shift.requestedStaffEmail,
            shift.staffBooking?.email,
          ]
            .filter(Boolean)
            .map((value) =>
              String(value).trim().toLowerCase()
            );

          const bookingBelongsToStaff =
            bookingStaffIds.includes(staffUid) ||
            (
              staffEmail &&
              bookingStaffEmails.includes(staffEmail)
            );

          if (!bookingBelongsToStaff) {
            throw new HttpsError(
              "permission-denied",
              "You can only cancel your own booking."
            );
          }

          const currentStatus = String(
            shift.status || ""
          )
            .trim()
            .toLowerCase();

          const cancellableStatuses = new Set([
            "booked",
            "pending_admin",
            "pending_admin_booking",
          ]);

          if (!cancellableStatuses.has(currentStatus)) {
            throw new HttpsError(
              "failed-precondition",
              "This booking can no longer be cancelled."
            );
          }

          let shiftDate = null;

          if (
            shift.date &&
            typeof shift.date.toDate === "function"
          ) {
            shiftDate = shift.date.toDate();
          } else if (shift.date?._seconds) {
            shiftDate = new Date(
              Number(shift.date._seconds) * 1000
            );
          } else if (
            typeof shift.date === "string" ||
            typeof shift.date === "number"
          ) {
            shiftDate = new Date(shift.date);
          }

          const startTime = String(
            shift.startTime || ""
          ).trim();

          if (
            !shiftDate ||
            Number.isNaN(shiftDate.getTime()) ||
            !startTime.includes(":")
          ) {
            throw new HttpsError(
              "failed-precondition",
              "The shift start time could not be verified. Please contact admin."
            );
          }

          const [hours, minutes] = startTime
            .split(":")
            .map(Number);

          if (
            !Number.isFinite(hours) ||
            !Number.isFinite(minutes)
          ) {
            throw new HttpsError(
              "failed-precondition",
              "The shift start time is invalid."
            );
          }

          const shiftStart = new Date(shiftDate);
          shiftStart.setHours(
            hours,
            minutes,
            0,
            0
          );

          const millisecondsUntilStart =
            shiftStart.getTime() - Date.now();

          const fortyEightHours =
            48 * 60 * 60 * 1000;

          if (millisecondsUntilStart <= 0) {
            throw new HttpsError(
              "failed-precondition",
              "A shift that has already started cannot be cancelled."
            );
          }

          if (
            millisecondsUntilStart <
            fortyEightHours
          ) {
            throw new HttpsError(
              "failed-precondition",
              "You cannot cancel this booking within 48 hours of the shift start time. Please contact admin."
            );
          }

          transaction.update(shiftRef, {
            status: "open",

            bookedBy: null,
            bookedAt: null,

            requestedStaffId: null,
            requestedStaffEmail: null,
            requestedStaffName: null,
            requestedStaffPublicId: null,

            bookedStaffId: null,
            bookedStaffEmail: null,
            bookedStaffName: null,
            bookedStaffPublicId: null,

            staffBooking: null,
            staffBookedBy: null,

            assignmentMethod: null,
            assignedDirectlyByAdmin: false,
            assignedByAdminId: null,
            assignedByAdminEmail: null,
            assignedAt: null,

            approvedByAdminId: null,
            approvedByAdminEmail: null,
            approvedAt: null,

            cancelledByStaffId: staffUid,
            cancelledByStaffEmail:
              staffEmail || null,
            cancelledAt:
              admin.firestore.FieldValue.serverTimestamp(),
            cancellationPreviousStatus:
              currentStatus,

            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });

          return {
            shiftDocumentId: shiftRef.id,
            shiftId:
              shift.shiftId || shiftRef.id,
          };
        }
      );

      return {
        ok: true,
        message:
          "Booking cancelled successfully.",
        ...result,
      };
    } catch (err) {
      console.error(
        "cancelShiftBookingV2 error:",
        err
      );

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError(
        "internal",
        err?.message ||
        "The booking could not be cancelled."
      );
    }
  }
);

/* ------------------------------------------------------------------ */
/* ✅ NEW: STAFF SUBMITS TIMESHEET (v2 callable)                        */
/* - Keeps your Firestore rules strict (staff doesn't write timesheets) */
/* - Validates: shift is theirs, booked/completed, opens 30min before end */
/* - Writes as admin in transaction                                    */
/* ------------------------------------------------------------------ */

function parseHHMM(t) {
  const s = safeString(t);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function buildDateFromShiftDateAndTime(shiftDate, timeStr) {
  const base =
    shiftDate && typeof shiftDate.toDate === "function"
      ? shiftDate.toDate()
      : shiftDate instanceof Date
        ? shiftDate
        : new Date();

  const parsed = parseHHMM(timeStr || "00:00");
  const d = new Date(base);
  if (!parsed) {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setHours(parsed.hh, parsed.mm, 0, 0);
  return d;
}

function calculateWorkedHours(startDate, endDate, breakMinutes) {
  let diffMs = endDate - startDate;
  if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000; // crossed midnight
  const totalMinutes = diffMs / (1000 * 60);
  const breakMins = Math.max(0, Number(breakMinutes) || 0);
  const worked = Math.max(0, totalMinutes - breakMins);
  const hours = worked / 60;
  return Math.round(hours * 4) / 4; // nearest 0.25
}

// Keep staffRate independent from clientRate
function readStaffRate(shift) {
  const v =
    shift?.rates?.staff ??
    shift?.staffRate ??
    shift?.staffRatePerHour ??
    shift?.hourlyRate ??
    shift?.rateStaff ??
    shift?.rateStaffPerHour ??
    null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readClientRate(shift) {
  const v =
    shift?.rates?.client ??
    shift?.clientRate ??
    shift?.billingRate ??
    shift?.clientHourlyRate ??
    shift?.clientRatePerHour ??
    shift?.rateClient ??
    shift?.rateClientPerHour ??
    null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ DROP-IN REPLACEMENT
 * Adds: paperStoragePath, paperFileUrl (+ optional clientSignature* fields)
 * Does NOT change any existing validations or flow.
 */
const {
  resolveTimesheetClientOwnership,
} = require("./timesheetOwnership");

exports.submitTimesheetV2 = onCall({ region: REGION }, async (request) => {
  try {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in.");
    }

    const uid = request.auth.uid;
    const shiftIdInput = safeString(request.data?.shiftId);
    if (!shiftIdInput)
      throw new HttpsError("invalid-argument", "Missing shiftId.");

    const breakMinutes = Number(request.data?.breakMinutes ?? 0);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
      throw new HttpsError(
        "invalid-argument",
        "Break minutes must be 0 or more."
      );
    }

    const clientName = safeString(request.data?.clientName);
    const clientRole = safeString(request.data?.clientRole);
    const clientSignedDate = safeString(request.data?.clientSignedDate);
    const staffSignedName = safeString(request.data?.staffSignedName);
    const staffDeclaration = request.data?.staffDeclaration === true;

    // existing field
    const paperFileName = safeString(request.data?.paperFileName);

    // ✅ NEW: persist upload metadata for admin viewing
    const paperStoragePath = safeString(request.data?.paperStoragePath);
    const paperFileUrl = safeString(request.data?.paperFileUrl);

    // ✅ OPTIONAL: client signature evidence (safe if not sent)
    const clientSignatureFileName = safeString(
      request.data?.clientSignatureFileName
    );
    const clientSignatureStoragePath = safeString(
      request.data?.clientSignatureStoragePath
    );
    const clientSignatureUrl = safeString(request.data?.clientSignatureUrl);

    if (!clientName || !clientRole || !clientSignedDate) {
      throw new HttpsError(
        "invalid-argument",
        "Client name, role and signed date are required."
      );
    }
    if (!staffDeclaration || !staffSignedName) {
      throw new HttpsError(
        "invalid-argument",
        "Staff declaration and signature are required."
      );
    }

    const db = admin.firestore();

    // ✅ supports both Firestore docId and SH-000001
    const shiftRef = await resolveShiftRefByDocIdOrPublicId(db, shiftIdInput);
    if (!shiftRef) throw new HttpsError("not-found", "Shift not found.");

    const shiftDocId = shiftRef.id; // Firestore document id (stable internal)
    const tsId = `${shiftDocId}_${uid}`;
    const tsRef = db.collection("timesheets").doc(tsId);

    await db.runTransaction(async (tx) => {
      const shiftSnap = await tx.get(shiftRef);
      if (!shiftSnap.exists)
        throw new HttpsError("not-found", "Shift not found.");

      const shift = shiftSnap.data() || {};
      const status = String(shift.status || "").toLowerCase();

      if (status !== "booked" && status !== "completed") {
        throw new HttpsError(
          "failed-precondition",
          "This shift is not eligible for a timesheet yet."
        );
      }

      const bookedBy = shift.bookedBy || shift.bookedStaffId || null;
      if (bookedBy !== uid) {
        throw new HttpsError(
          "permission-denied",
          "This shift is not assigned to you."
        );
      }

      const ownership =
        resolveTimesheetClientOwnership(
          shift
        );

      if (!ownership.clientId) {
        throw new HttpsError(
          "failed-precondition",
          "This shift is missing its client ownership details. Please contact Unity admin."
        );
      }

      const endDate = buildDateFromShiftDateAndTime(shift.date, shift.endTime);
      const openFrom = new Date(endDate.getTime() - 30 * 60 * 1000);

      if (new Date() < openFrom) {
        throw new HttpsError(
          "failed-precondition",
          "Timesheet is not open yet. It opens 30 minutes before shift end."
        );
      }

      const startDate = buildDateFromShiftDateAndTime(
        shift.date,
        shift.startTime
      );
      const hoursWorked = calculateWorkedHours(
        startDate,
        endDate,
        breakMinutes
      );

      const staffRate = readStaffRate(shift);
      const clientRate = readClientRate(shift);

      const baseData = {
        // ✅ IMPORTANT:
        // shiftId = Firestore docId (internal reference used across app)
        shiftId: shiftDocId,

        // ✅ ALSO store the public shift code for display (SH-000001)
        shiftPublicId: shift.shiftId || shift.publicId || null,

        staffId: uid,

        // Server-derived client ownership.
        clientId: ownership.clientId,
        clientUid: ownership.clientUid,
        clientUserId: ownership.clientUserId,
        clientEmail: ownership.clientEmail,
        clientOrganisation:
          ownership.clientOrganisation,
        clientPublicId:
          ownership.clientPublicId,

        shiftLocation: shift.location || null,
        shiftRole: shift.role || null,
        shiftDate: shift.date || null,
        shiftStartTime: shift.startTime || null,
        shiftEndTime: shift.endTime || null,

        staffRate: staffRate,
        clientRate: clientRate,

        breakMinutesStaff: breakMinutes,
        hoursWorkedStaff: hoursWorked,

        clientName,
        clientRole,
        clientSignedDate,
        clientSignedAt: Timestamp.now(),

        staffDeclaration: true,
        staffSignedName,
        staffSignedAt: Timestamp.now(),

        // existing
        paperFileName: paperFileName || null,

        // ✅ NEW: evidence metadata (non-breaking)
        paperStoragePath: paperStoragePath || null,
        paperFileUrl: paperFileUrl || null,

        // ✅ OPTIONAL: client signature evidence (non-breaking)
        clientSignatureFileName: clientSignatureFileName || null,
        clientSignatureStoragePath: clientSignatureStoragePath || null,
        clientSignatureUrl: clientSignatureUrl || null,

        status: "submitted",
        submittedAt: Timestamp.now(),

        // important for your read rule: availableAt <= now
        availableAt: Timestamp.fromDate(openFrom),

        updatedAt: Timestamp.now(),
        updatedAtServer: FieldValue.serverTimestamp(),
      };

      const tsSnap = await tx.get(tsRef);
      if (!tsSnap.exists) {
        tx.set(tsRef, baseData, { merge: true });
      } else {
        const existing = tsSnap.data() || {};
        const st = String(existing.status || "").toLowerCase();
        if (st === "approved") {
          throw new HttpsError(
            "failed-precondition",
            "This timesheet is already approved."
          );
        }
        tx.set(tsRef, baseData, { merge: true });
      }
    });

    return { ok: true };
  } catch (err) {
    console.error("submitTimesheetV2 error:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      "internal",
      err?.message || "Could not submit timesheet."
    );
  }
});

/* ------------------------------------------------------------------ */
/* ✅ CREATE INVOICE WHEN TIMESHEET BECOMES APPROVED (v2)               */
/* - triggers only on status transition -> approved                     */
/* - reads shift to attach correct clientId / clientEmail               */
/* - creates invoices/{timesheetId} idempotently (no duplicates)        */
/* ------------------------------------------------------------------ */

function numOrNull(v) {
  const n =
    typeof v === "number"
      ? v
      : v == null || v === ""
        ? NaN
        : Number(v);
  return Number.isFinite(n) ? n : null;
}

function money2(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

exports.createInvoiceOnTimesheetApprovedV2 = onDocumentUpdated(
  { document: "timesheets/{timesheetId}", region: REGION },
  async (event) => {
    try {
      const before = event.data?.before?.data?.() || {};
      const after = event.data?.after?.data?.() || {};
      const timesheetId = event.params.timesheetId;

      const beforeStatus = String(before.status || "").toLowerCase();
      const afterStatus = String(after.status || "").toLowerCase();

      // only on transition -> approved
      if (afterStatus !== "approved" || beforeStatus === "approved") return;

      const shiftDocId = after.shiftId; // ✅ internal Firestore doc id
      if (!shiftDocId) {
        console.error("Approved timesheet missing shiftId:", timesheetId);
        return;
      }

      const db = admin.firestore();

      // fetch shift to find client owner fields
      const shiftRef = db.collection("shifts").doc(shiftDocId);
      const shiftSnap = await shiftRef.get();
      if (!shiftSnap.exists) {
        console.error("Shift not found for approved timesheet:", {
          timesheetId,
          shiftId: shiftDocId,
        });
        return;
      }
      const shift = shiftSnap.data() || {};

      const clientId = shift.clientId || shift.createdBy || null;
      const clientEmail = shift.clientEmail || null;

      if (!clientId) {
        console.error("Shift missing clientId/createdBy:", {
          shiftId: shiftDocId,
          timesheetId,
        });
        return;
      }

      // hours: finalHours first (AdminTimesheets writes this), then admin override, then staff calc
      const hours =
        numOrNull(after.finalHours) ??
        numOrNull(after.hoursWorkedAdmin) ??
        numOrNull(after.hoursWorkedStaff);

      // rate: timesheet clientRate first, then shift fallbacks
      const rate =
        numOrNull(after.clientRate) ??
        numOrNull(shift?.rates?.client) ??
        numOrNull(shift?.clientRate) ??
        numOrNull(shift?.billingRate) ??
        numOrNull(shift?.clientHourlyRate) ??
        numOrNull(shift?.hourlyRate);

      const staffNeeded = numOrNull(shift.staffNeeded) ?? 1;

      if (hours == null || rate == null) {
        console.warn("Invoice skipped (missing hours or rate):", {
          timesheetId,
          shiftId: shiftDocId,
          hours,
          rate,
        });
        return;
      }

      const total = money2(hours * rate * staffNeeded);
      if (total == null) return;

      // ✅ idempotent invoice id = timesheetId (so it never duplicates)
      const invoiceRef = db.collection("invoices").doc(timesheetId);

      await db.runTransaction(async (tx) => {
        const invSnap = await tx.get(invoiceRef);
        if (invSnap.exists) return;

        tx.set(invoiceRef, {
          // ✅ ownership fields (match your Firestore rules)
          clientId,
          clientUid: clientId,
          clientUserId: clientId,
          clientEmail: clientEmail,
          email: clientEmail,

          // links
          invoiceId: timesheetId,
          timesheetId,
          shiftId: shiftDocId,

          // ✅ store public shift ID for display everywhere
          shiftPublicId: shift.shiftId || shift.publicId || null,

          // status for client UI
          status: "payment_due",

          // amounts
          hours,
          rate,
          staffNeeded,
          totalAmount: total,
          amountDue: total,

          // display fields
          organisation:
            shift.clientOrganisation ||
            shift.clientName ||
            after.shiftLocation ||
            null,
          shiftLocation: after.shiftLocation || shift.location || null,
          shiftRole: after.shiftRole || shift.role || null,
          shiftDate: after.shiftDate || shift.date || null,
          shiftStartTime: after.shiftStartTime || shift.startTime || null,
          shiftEndTime: after.shiftEndTime || shift.endTime || null,

          staffName:
            after.staffSignedName ||
            shift.bookedStaffName ||
            shift.requestedStaffName ||
            null,

          // audit
          approvedAt:
            after.approvedAt || admin.firestore.FieldValue.serverTimestamp(),
          approvedByName: after.approvedByName || after.approvedBy || null,
          approvedByEmail: after.approvedByEmail || null,

          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      console.log("Invoice created:", {
        invoiceId: timesheetId,
        shiftId: shiftDocId,
      });
    } catch (err) {
      console.error("createInvoiceOnTimesheetApprovedV2 error:", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* PROTECTED ADMINISTRATOR ACCESS MANAGEMENT (v2)                    */
/* ------------------------------------------------------------------ */

const {
  createManageAdminAccessHandler,
} = require("./adminAccessManagement");

exports.manageAdminAccessV2 = onCall(
  { region: REGION },
  createManageAdminAccessHandler({
    admin,
    HttpsError,
    serverTimestamp: () =>
      FieldValue.serverTimestamp(),
  })
);
/* ------------------------------------------------------------------ */
/* PROTECTED ADMINISTRATOR INVENTORY (v2)                            */
/* ------------------------------------------------------------------ */

const {
  createAdminAccessInventoryHandler,
} = require("./adminAccessInventoryHandler");

exports.getAdminAccessInventoryV2 = onCall(
  { region: REGION },
  createAdminAccessInventoryHandler({
    admin,
    HttpsError,
  })
);
