// src/components/ClientMyInvoices.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

/* ---------------- Helpers ---------------- */

function safeStr(v) {
  return v == null ? "" : String(v);
}

function toDateMaybe(ts) {
  // Firestore Timestamp or Date-ish
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "-";
  return `£${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d) {
  try {
    if (!d) return "-";
    return d.toLocaleDateString("en-GB");
  } catch {
    return "-";
  }
}

function mergeById(...arrays) {
  const map = new Map();
  arrays.flat().forEach((x) => {
    if (x && x.id) map.set(x.id, x);
  });
  return Array.from(map.values());
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function getInvoiceStaffFirstName(value) {
  const text = String(value || "").trim();

  // Do not display staff email addresses to clients.
  if (!text || text.includes("@")) {
    return "";
  }

  return text.split(/\s+/)[0];
}

function getInvoiceStaffDisplay(record) {
  const firstName = getInvoiceStaffFirstName(
    record?.bookedStaffFirstName ||
    record?.requestedStaffFirstName ||
    record?.staffFirstName ||
    record?.assignedStaffFirstName ||
    record?.staffBooking?.firstName ||
    record?.bookedStaffName ||
    record?.requestedStaffName ||
    record?.assignedStaffName ||
    record?.staffBooking?.staffName ||
    record?.staffBooking?.name ||
    record?.staffName ||
    record?.staff ||
    ""
  );

  const publicId = String(
    record?.bookedStaffPublicId ||
    record?.requestedStaffPublicId ||
    record?.assignedStaffPublicId ||
    record?.staffBooking?.publicId ||
    record?.staffBooking?.staffPublicId ||
    record?.staffPublicId ||
    record?.staffCode ||
    ""
  ).trim();

  if (firstName && publicId) {
    return `${firstName} (${publicId})`;
  }

  if (firstName) {
    return firstName;
  }

  if (publicId) {
    return `Staff (${publicId})`;
  }

  return "-";
}

// ✅ Make invoice number short (6 digits) without changing stored data
function short6FromRef(input) {
  const s = safeStr(input).trim();
  if (!s) return "";

  // If ref looks like SH-000001 -> return 000001
  const m = s.match(/SH-(\d{6})/i);
  if (m && m[1]) return m[1];

  // If it's all digits and >= 6 -> last 6
  if (/^\d+$/.test(s) && s.length >= 6) return s.slice(-6);

  // Extract digits anywhere and take last 6 (works for long ids containing digits)
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(-6);

  // Fallback: if string is long, show last 6 chars; else show as-is
  if (s.length > 6) return s.slice(-6);
  return s;
}

/* ✅ ADDED: normalize payment status to "paid" | "payment_due" (resilient) */
function normalizePaymentStatus(raw) {
  const s = safeStr(
    raw?.status ||
    raw?.paymentStatus ||
    raw?.invoiceStatus ||
    raw?.billingStatus ||
    ""
  )
    .trim()
    .toLowerCase();

  if (s) {
    if (s.includes("paid")) return "paid";
    if (s.includes("due")) return "payment_due";
    if (s.includes("unpaid")) return "payment_due";
    if (s.includes("outstanding")) return "payment_due";
    return s; // keep unknown custom statuses visible
  }

  if (raw?.paid === true || raw?.isPaid === true) return "paid";
  return "payment_due";
}

/* ✅ ADDED: interpret "paid" from a shift document (best-effort) */
function isShiftPaidDoc(shiftDoc) {
  if (!shiftDoc || typeof shiftDoc !== "object") return false;

  const s = safeStr(
    shiftDoc.status ||
    shiftDoc.paymentStatus ||
    shiftDoc.invoiceStatus ||
    shiftDoc.billingStatus ||
    ""
  )
    .trim()
    .toLowerCase();

  if (s && s.includes("paid")) return true;
  if (shiftDoc.paid === true || shiftDoc.isPaid === true) return true;

  // Some projects store booleans under nested objects; we won't assume structure,
  // but we safely check common nested patterns without breaking anything.
  const nestedPaid =
    shiftDoc.payment?.paid === true ||
    shiftDoc.billing?.paid === true ||
    shiftDoc.invoice?.paid === true;

  return !!nestedPaid;
}

function normalizeInvoice(raw) {
  // Make the UI resilient even if invoice documents vary a bit
  const createdAt =
    raw.createdAt || raw.invoiceCreatedAt || raw.generatedAt || raw.issuedAt || null;

  const periodStart =
    raw.periodStart || raw.fromDate || raw.startDate || raw.shiftDate || null;
  const periodEnd =
    raw.periodEnd || raw.toDate || raw.endDate || raw.shiftDate || null;

  const amount =
    raw.totalAmount ??
    raw.amountDue ??
    raw.amount ??
    raw.total ??
    raw.balanceDue ??
    null;

  const status = normalizePaymentStatus(raw);

  const ref =
    raw.invoiceNumber ||
    raw.invoiceNo ||
    raw.reference ||
    raw.ref ||
    raw.publicId ||
    raw.id ||
    "";

  const organisation =
    raw.clientOrganisation ||
    raw.organisation ||
    raw.organisationName ||
    raw.clientName ||
    raw.location ||
    "-";

  const staff = getInvoiceStaffDisplay(raw);

  // ✅ extra fields for popup audit / tracking (non-breaking)
  const shiftPublicId =
    raw.shiftPublicId || raw.shiftPublicID || raw.shiftCode || raw.shiftRef || null;

  const shiftId =
    raw.shiftId || raw.shiftDocId || raw.shiftDocumentId || null;

  const shiftBookedByName =
    raw.shiftBookedByName || raw.shiftBookedBy || raw.createdByName || raw.createdBy || null;

  const timesheetApprovedByName =
    raw.timesheetApprovedByName || raw.approvedByName || raw.approvedBy || null;

  // ✅ prefer public shift id for display; else use invoice ref
  const displayRefSource = shiftPublicId || ref || raw.id || "";
  const refShort = short6FromRef(displayRefSource);

  // ✅ derived booleans for badges (non-breaking)
  const isPaid = String(status || "").toLowerCase().includes("paid");

  return {
    ...raw,
    createdAt,
    periodStart,
    periodEnd,
    amount,
    status,
    ref,
    refShort,
    organisation,
    staff,

    // keep on normalized object for UI
    shiftPublicId,
    shiftId,
    shiftBookedByName,
    timesheetApprovedByName,

    // ✅ ADDED: convenience
    isPaid,
  };
}

function downloadCSV(rows, filename = "invoices.csv") {
  const header = [
    "Invoice Ref",
    "Organisation",
    "Staff",
    "Status",
    "Amount",
    "Created At",
    "Period Start",
    "Period End",
  ];

  const escape = (v) => {
    const s = safeStr(v).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [
    header.map(escape).join(","),
    ...rows.map((r) =>
      [
        // ✅ export the short reference (still derived from stored fields)
        r.refShort || r.ref,
        r.organisation,
        r.staff,
        r.status,
        r.amount,
        formatDate(toDateMaybe(r.createdAt)),
        formatDate(toDateMaybe(r.periodStart)),
        formatDate(toDateMaybe(r.periodEnd)),
      ]
        .map(escape)
        .join(",")
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/* ---------------- Component ---------------- */

export default function ClientMyInvoices({ currentUser }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Sort
  const [sortPeriod, setSortPeriod] = useState("newest"); // newest | oldest
  // ✅ sort by status
  const [sortStatus, setSortStatus] = useState("all"); // all | paid | payment_due
  // ✅ ADDED: date range filter (YYYY-MM-DD)
  const [rangeStart, setRangeStart] = useState(""); // e.g. 2026-01-01
  const [rangeEnd, setRangeEnd] = useState(""); // e.g. 2026-01-07

  // Search
  const [searchTerm, setSearchTerm] = useState("");
  // Modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // prevent state updates after unmount
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const uid = currentUser?.uid || "";
  const email = (currentUser?.email || "").trim();

  // ✅ period label like "1/1/2026-7/1/2026"
  const getPeriodLabel = useCallback((inv) => {
    const start = toDateMaybe(inv?.periodStart);
    const end = toDateMaybe(inv?.periodEnd);

    if (start && end) {
      return `${formatDate(start)}-${formatDate(end)}`;
    }

    if (start) return formatDate(start);
    if (end) return formatDate(end);

    // fallback: use createdAt if period is missing
    const created = toDateMaybe(inv?.createdAt);
    return created ? formatDate(created) : "-";
  }, []);

  // ✅ a single “period key” for sorting (periodEnd -> periodStart -> createdAt)
  const getPeriodSortDate = useCallback((inv) => {
    return (
      toDateMaybe(inv?.periodEnd) ||
      toDateMaybe(inv?.periodStart) ||
      toDateMaybe(inv?.createdAt) ||
      null
    );
  }, []);

  // ✅ ADDED: normalize date input (YYYY-MM-DD) to Date at start/end of day
  const parseRangeStart = useCallback((s) => {
    if (!s) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, []);
  const parseRangeEnd = useCallback((s) => {
    if (!s) return null;
    const d = new Date(`${s}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, []);

  const loadInvoices = useCallback(async () => {
    if (!uid && !email) return;

    setLoading(true);
    setError("");

    try {
      const invRef = collection(db, "invoices");

      // ✅ multiple queries because Firestore doesn't support OR across different fields in one query
      const queries = [];

      if (uid) {
        queries.push(getDocs(query(invRef, where("clientId", "==", uid))).catch((e) => e));
        queries.push(getDocs(query(invRef, where("clientUid", "==", uid))).catch((e) => e));
        queries.push(getDocs(query(invRef, where("clientUserId", "==", uid))).catch((e) => e));
        queries.push(getDocs(query(invRef, where("uid", "==", uid))).catch((e) => e));
      }
      if (email) {
        queries.push(getDocs(query(invRef, where("clientEmail", "==", email))).catch((e) => e));
        queries.push(getDocs(query(invRef, where("email", "==", email))).catch((e) => e));
      }

      const snaps = await Promise.all(queries);

      // If every query failed with permission denied, show a helpful message
      const allDenied = snaps.every(
        (s) => s && typeof s === "object" && String(s.code || "").includes("permission-denied")
      );
      if (allDenied) {
        throw Object.assign(new Error("permission-denied"), { code: "permission-denied" });
      }

      const fromSnap = (snap) => snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) || [];

      // Base normalize
      let merged = mergeById(...snaps.map(fromSnap)).map(normalizeInvoice);

      // ✅ if admin marked SHIFT as paid (not invoice), reflect it on invoice badge
      const shiftDataCache = new Map();

      const uniqueShiftIds = Array.from(
        new Set(
          merged
            .map((invoice) =>
              String(invoice.shiftId || "").trim()
            )
            .filter(Boolean)
        )
      );

      if (uniqueShiftIds.length) {
        await Promise.all(
          uniqueShiftIds.map(async (shiftDocumentId) => {
            if (
              !shiftDocumentId ||
              shiftDataCache.has(shiftDocumentId)
            ) {
              return;
            }

            try {
              const shiftSnapshot = await getDoc(
                doc(db, "shifts", shiftDocumentId)
              );

              const shiftData = shiftSnapshot.exists()
                ? shiftSnapshot.data()
                : null;

              shiftDataCache.set(
                shiftDocumentId,
                shiftData
              );
            } catch {
              // Continue displaying the invoice when a shift
              // cannot be read.
              shiftDataCache.set(
                shiftDocumentId,
                null
              );
            }
          })
        );

        merged = merged.map((invoice) => {
          const shiftDocumentId = String(
            invoice.shiftId || ""
          ).trim();

          const shiftData = shiftDocumentId
            ? shiftDataCache.get(shiftDocumentId)
            : null;

          const shiftPaid =
            isShiftPaidDoc(shiftData);

          const alreadyPaid =
            invoice.isPaid === true ||
            String(invoice.status || "")
              .toLowerCase()
              .includes("paid");

          const isPaid =
            alreadyPaid || shiftPaid;

          const status = isPaid
            ? "paid"
            : invoice.status;

          const combinedStaffData = {
            ...invoice,
            ...(shiftData || {}),
          };

          const staff =
            getInvoiceStaffDisplay(
              combinedStaffData
            );

          const shiftPublicId =
            invoice.shiftPublicId ||
            shiftData?.shiftId ||
            shiftData?.publicId ||
            shiftData?.shiftCode ||
            null;

          return {
            ...invoice,
            isPaid,
            status,
            staff,
            shiftPublicId,
          };
        });
      }

      // ✅ Sort by PERIOD key (periodEnd/periodStart/createdAt)
      merged.sort((a, b) => {
        const da = getPeriodSortDate(a) || new Date(0);
        const dbb = getPeriodSortDate(b) || new Date(0);
        return sortPeriod === "oldest" ? da - dbb : dbb - da;
      });

      if (!aliveRef.current) return;
      setInvoices(merged);
    } catch (err) {
      console.error("Error loading invoices:", err);
      const code = String(err?.code || "");
      if (code.includes("permission-denied")) {
        setError(
          "Permission denied. Your client account may not have access to invoices yet. Please contact Unity admin."
        );
      } else {
        setError("Could not load invoices. Please try again.");
      }
      setInvoices([]);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [uid, email, sortPeriod, getPeriodSortDate]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    let list = invoices;

    // ✅ ADDED: date range filter (based on the same period key used for sorting)
    const startD = parseRangeStart(rangeStart);
    const endD = parseRangeEnd(rangeEnd);

    if (startD || endD) {
      list = list.filter((inv) => {
        const d = getPeriodSortDate(inv);
        if (!d) return false;
        if (startD && d < startD) return false;
        if (endD && d > endD) return false;
        return true;
      });
    }

    // ✅ status filter
    if (sortStatus !== "all") {
      list = list.filter((inv) => {
        const st = String(inv.status || "").toLowerCase();
        if (sortStatus === "paid") return st.includes("paid") || inv.isPaid === true;
        if (sortStatus === "payment_due") return st.includes("due") || !st.includes("paid");
        return true;
      });
    }

    if (!term) return list;

    return list.filter((inv) => {
      const hay = [
        inv.refShort,
        inv.ref,
        inv.organisation,
        inv.staff,
        inv.status,
        safeStr(inv.amount),
        safeStr(inv.clientOrganisation),
        safeStr(inv.clientName),
        safeStr(inv.shiftPublicId),
        safeStr(inv.shiftId),
        safeStr(inv.shiftBookedByName),
        safeStr(inv.timesheetApprovedByName),
        // include period label in search
        safeStr(getPeriodLabel(inv)),
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(term);
    });
  }, [
    invoices,
    searchTerm,
    sortStatus,
    rangeStart,
    rangeEnd,
    parseRangeStart,
    parseRangeEnd,
    getPeriodSortDate,
    getPeriodLabel,
  ]);

  // ✅ estimated total (sum of visible rows)
  const estimatedTotal = useMemo(() => {
    return filteredInvoices.reduce((sum, inv) => sum + safeNum(inv?.amount, 0), 0);
  }, [filteredInvoices]);

  // ✅ keep filtered list sorted by PERIOD when user changes dropdown (without reloading)
  const sortedFilteredInvoices = useMemo(() => {
    const list = [...filteredInvoices];
    list.sort((a, b) => {
      const da = getPeriodSortDate(a) || new Date(0);
      const dbb = getPeriodSortDate(b) || new Date(0);
      return sortPeriod === "oldest" ? da - dbb : dbb - da;
    });
    return list;
  }, [filteredInvoices, sortPeriod, getPeriodSortDate]);

  const openModal = (inv) => setSelectedInvoice(inv);
  const closeModal = () => setSelectedInvoice(null);

  const paymentDueCount = useMemo(() => {
    return sortedFilteredInvoices.filter((x) =>
      String(x.status || "").toLowerCase().includes("due")
    ).length;
  }, [sortedFilteredInvoices]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-slate-900">
              My Invoices
            </h2>
            <p className="text-xs md:text-sm text-slate-600">
              Signed and approved timesheets will show here as{" "}
              <span className="font-semibold">Payment due</span>. Search, sort
              and export for your records.
            </p>

            {!!sortedFilteredInvoices.length && (
              <p className="mt-1 text-[11px] text-slate-500">
                Showing{" "}
                <span className="font-semibold">{sortedFilteredInvoices.length}</span>{" "}
                invoice(s) · Payment due:{" "}
                <span className="font-semibold">{paymentDueCount}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadInvoices}
              className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => downloadCSV(sortedFilteredInvoices, "unity-invoices.csv")}
              disabled={!sortedFilteredInvoices.length}
              className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Download CSV
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Search:</span>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Organisation, staff, status, period..."
              className="uh-input !h-8 !py-1 !text-[11px] w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Order:</span>
            <select
              value={sortPeriod}
              onChange={(e) => setSortPeriod(e.target.value)}
              className="uh-input !h-8 !py-1 !text-[11px] bg-white"
              title="Sort by period"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          {/* ✅ ADDED: date range filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Period:</span>
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="uh-input !h-8 !py-1 !text-[11px] bg-white"
              title="Start date"
            />
            <span className="text-[11px] text-slate-400">→</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="uh-input !h-8 !py-1 !text-[11px] bg-white"
              title="End date"
            />
          </div>

          {/* ✅ sort/filter by status */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Status:</span>
            <select
              value={sortStatus}
              onChange={(e) => setSortStatus(e.target.value)}
              className="uh-input !h-8 !py-1 !text-[11px] bg-white"
            >
              <option value="all">All</option>
              <option value="payment_due">Payment due</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        {/* ✅ Estimated total */}
        {!!sortedFilteredInvoices.length && !loading && !error && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
            <span className="text-slate-500">Estimated total:</span>{" "}
            <span className="font-semibold">{formatMoney(estimatedTotal)}</span>
          </div>
        )}

        {/* States */}
        {error && (
          <div className="mt-3 text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-3 text-sm text-slate-600">Loading invoices…</div>
        ) : !sortedFilteredInvoices.length ? (
          <div className="mt-3 text-sm text-slate-600">No invoices found.</div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="uh-client-data-table min-w-full text-xs bg-white">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] font-semibold text-slate-600">
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Shift ID</th>
                  <th className="px-3 py-2">Organisation</th>
                  <th className="px-3 py-2">Staff</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedFilteredInvoices.map((inv) => {
                  const created = toDateMaybe(inv.createdAt);
                  const status = String(inv.status || "payment_due");

                  const statusLower = status.toLowerCase();
                  const isPaid = inv.isPaid === true || statusLower.includes("paid");

                  const badge = isPaid
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-amber-50 text-amber-800 border border-amber-200";

                  const paidBadge = isPaid
                    ? "bg-violet-50 text-violet-800 border border-violet-200"
                    : "bg-slate-50 text-slate-600 border border-slate-200";

                  const invoiceMain = inv.refShort || inv.ref || inv.id;

                  const invoiceSub =
                    inv.shiftPublicId || inv.shiftId
                      ? `Shift: ${inv.shiftPublicId || inv.shiftId}`
                      : "";

                  const periodLabel = getPeriodLabel(inv);

                  return (
                    <tr key={inv.id} className="uh-client-data-row">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">
                          {invoiceMain}
                        </div>
                        {!!invoiceSub && (
                          <div className="text-[10px] text-slate-500">
                            {invoiceSub}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-cyan-800">
                          {inv.shiftPublicId ||
                            inv.shiftId ||
                            "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {inv.organisation || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {inv.staff || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}
                        >
                          {status}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-slate-600">{periodLabel}</td>

                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${paidBadge}`}
                          title={isPaid ? "Invoice/Shift marked as paid" : "Not marked as paid"}
                        >
                          {isPaid ? "Paid" : "Not paid"}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-slate-700">
                        {formatMoney(inv.amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {formatDate(created)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openModal(inv)}
                          className="text-[11px] font-medium text-cyan-700 hover:text-cyan-800"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-3">
          <div className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Invoice:{" "}
                  {selectedInvoice.refShort ||
                    selectedInvoice.ref ||
                    selectedInvoice.id}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Organisation: {selectedInvoice.organisation || "-"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-xs px-3 py-1 rounded-full border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className="font-semibold text-slate-900">
                  {safeStr(selectedInvoice.status || "payment_due")}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Paid</span>
                <span className="font-semibold text-slate-900">
                  {selectedInvoice.isPaid === true ||
                    String(selectedInvoice.status || "").toLowerCase().includes("paid")
                    ? "Yes"
                    : "No"}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Amount due</span>
                <span className="font-semibold text-slate-900">
                  {formatMoney(selectedInvoice.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-700">
                  {formatDate(toDateMaybe(selectedInvoice.createdAt))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Period</span>
                <span className="text-slate-700">
                  {formatDate(toDateMaybe(selectedInvoice.periodStart))} →{" "}
                  {formatDate(toDateMaybe(selectedInvoice.periodEnd))}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Shift ID</span>
                <span className="text-slate-700">
                  {safeStr(selectedInvoice.shiftPublicId || selectedInvoice.shiftId || "-")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Shift created by</span>
                <span className="text-slate-700">
                  {safeStr(selectedInvoice.shiftBookedByName || "-")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Timesheet approved by</span>
                <span className="text-slate-700">
                  {safeStr(selectedInvoice.timesheetApprovedByName || "-")}
                </span>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-600">
              {selectedInvoice.notes ? (
                <>
                  <div className="font-semibold text-slate-700">Notes</div>
                  <div className="whitespace-pre-wrap">
                    {safeStr(selectedInvoice.notes)}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .uh-input {
          border: 1px solid #cbd5e1;
          border-radius: 9999px;
          padding: 8px 10px;
          outline: none;
          font-size: 0.8rem;
          background-color: #ffffff;
        }
        .uh-input:focus {
          border-color: #0e7490;
          box-shadow: 0 0 0 1px #22d3ee33;
        }
      `}</style>
    </div>
  );
}
