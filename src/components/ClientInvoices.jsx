// src/components/ClientInvoices.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  canViewAdminTab,
  resolveAdminAccess,
} from "../utils/adminAccess";


export default function ClientInvoices({ currentUser }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Sorting
  const [sortClient, setSortClient] = useState("az"); // az | za
  const [sortPeriod, setSortPeriod] = useState("newest"); // newest | oldest

  // ✅ ADDED: sort/filter by status (paid / unpaid / all)
  const [sortStatus, setSortStatus] = useState("all"); // all | paid | unpaid

  // ✅ ADDED: date range filter (YYYY-MM-DD inputs)
  const [rangeStart, setRangeStart] = useState(""); // e.g. 2026-01-01
  const [rangeEnd, setRangeEnd] = useState(""); // e.g. 2026-01-07

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // Modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // prevent setState after unmount
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const safeSet = (fn) => {
    if (aliveRef.current) fn();
  };

  const asDate = (maybeTimestamp) => {
    if (maybeTimestamp?.toDate && typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate();
    }
    if (typeof maybeTimestamp === "string") {
      const d = new Date(maybeTimestamp);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (maybeTimestamp instanceof Date) return maybeTimestamp;
    return null;
  };

  const safeNum = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const toPeriodLabel = (inv) => {
    if (inv?.period) return String(inv.period);

    const d =
      asDate(inv.createdAt) ||
      asDate(inv.issuedAt) ||
      asDate(inv.date) ||
      asDate(inv.shiftDate) ||
      null;

    if (!d) return "";
    const month = d.toLocaleString("en-GB", { month: "short" });
    const year = d.getFullYear();
    return `${month} ${year}`;
  };

  const makeInvoiceNoFromTimesheet = (timesheetId) => {
    const t = String(timesheetId || "").trim();
    if (!t) return "";
    const tail = t.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
    return `TS-${tail || t.slice(0, 8).toUpperCase()}`;
  };

  /* ✅ ADDED: derive a consistent "paid" flag from invoice row (invoice doc OR timesheet-derived OR shift) */
  const getIsPaid = (inv) => {
    const statusStr = String(inv?.status || inv?.paymentStatus || "").toLowerCase();
    if (statusStr.includes("paid")) return true;
    if (inv?.paid === true || inv?.isPaid === true) return true;
    return false;
  };

  /* ✅ ADDED: best-effort created/period date for range filtering */
  const getRowDate = (inv) => {
    return (
      asDate(inv.createdAt) ||
      asDate(inv.issuedAt) ||
      asDate(inv.date) ||
      asDate(inv.shiftDate) ||
      null
    );
  };

  /* ✅ ADDED: normalize date input (YYYY-MM-DD) to Date at start/end of day */
  const parseRangeStart = (s) => {
    if (!s) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const parseRangeEnd = (s) => {
    if (!s) return null;
    const d = new Date(`${s}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  /*
   * Resolve the signed-in user's tested administrator
   * access model. Protected Super Admins do not require
   * a Firestore profile read.
   */
  const loadCurrentAdminAccess = async () => {
    if (!currentUser) {
      return resolveAdminAccess(
        null,
        null
      );
    }

    const protectedAccess =
      resolveAdminAccess(
        currentUser,
        null
      );

    if (protectedAccess.isSuperAdmin) {
      return protectedAccess;
    }

    if (!currentUser.uid) {
      return protectedAccess;
    }

    try {
      const snapshot =
        await getDoc(
          doc(db, "users", currentUser.uid)
        );

      const profile =
        snapshot.exists()
          ? snapshot.data()
          : null;

      return resolveAdminAccess(
        currentUser,
        profile
      );
    } catch (error) {
      console.error(
        "Could not load administrator access profile:",
        error
      );

      return protectedAccess;
    }
  };
  /**
   * ✅ Determine organisation/client name for invoice rows (from timesheets)
   * IMPORTANT:
   * - We do NOT use ts.clientName because you may repurpose it to store "approved by".
   * - Prefer shift.organisationName/clientName/companyName (the true client organisation).
   * - If missing, try clients/{clientId}.
   */
  const getOrganisationNameForShift = async (shiftId, clientIdFromShift) => {
    const clean = (v) => String(v || "").trim();

    // If we have a clientId, try clients/{clientId}
    const tryClientDoc = async (clientId) => {
      const cid = clean(clientId);
      if (!cid) return "";
      try {
        const cSnap = await getDoc(doc(db, "clients", cid));
        const c = cSnap.exists() ? cSnap.data() : {};
        return (
          clean(c.name) ||
          clean(c.clientName) ||
          clean(c.organisationName) ||
          clean(c.organizationName) ||
          clean(c.companyName) ||
          ""
        );
      } catch {
        return "";
      }
    };

    // Try shift doc first for accurate display
    const sid = clean(shiftId);
    if (sid) {
      try {
        const sSnap = await getDoc(doc(db, "shifts", sid));
        const s = sSnap.exists() ? sSnap.data() : {};

        const fromShift =
          clean(s.organisationName) ||
          clean(s.organizationName) ||
          clean(s.clientName) ||
          clean(s.client) ||
          clean(s.companyName) ||
          "";

        const shiftClientId =
          clean(s.clientId) ||
          clean(s.clientID) ||
          clean(s.organisationId) ||
          clean(s.organizationId) ||
          clean(clientIdFromShift) ||
          "";

        if (fromShift) return fromShift;

        // shift didn't have a display name -> try clients doc
        const fromClientDoc = await tryClientDoc(shiftClientId);
        if (fromClientDoc) return fromClientDoc;
      } catch {
        // if shift read fails, fall back to clients doc
        const fromClientDoc = await tryClientDoc(clientIdFromShift);
        if (fromClientDoc) return fromClientDoc;
      }
    }

    // Final fallback: clients doc if possible
    const fromClientDoc = await tryClientDoc(clientIdFromShift);
    return fromClientDoc || "";
  };

  /* ✅ ADDED: fetch shift display/public id and paid status (best-effort, cached) */
  const getShiftMeta = async (shiftId) => {
    const sid = String(shiftId || "").trim();
    if (!sid) return { shiftDisplayId: "", shiftIsPaid: null };

    try {
      const sSnap = await getDoc(doc(db, "shifts", sid));
      if (!sSnap.exists()) return { shiftDisplayId: sid, shiftIsPaid: null };

      const s = sSnap.data() || {};

      const shiftDisplayId =
        String(s.shiftId || "").trim() ||
        String(s.publicId || "").trim() ||
        sid;

      const shiftStatusStr = String(s.status || "").toLowerCase();
      const shiftIsPaid =
        shiftStatusStr.includes("paid") || s.paid === true || s.isPaid === true
          ? true
          : null;

      return { shiftDisplayId, shiftIsPaid };
    } catch {
      return { shiftDisplayId: sid, shiftIsPaid: null };
    }
  };

  const loadInvoices = async () => {
    safeSet(() => {
      setLoading(true);
      setError("");
    });

    try {
      if (!currentUser?.uid) {
        safeSet(() => {
          setInvoices([]);
          setError("You must be signed in.");
        });
        return;
      }

      // ✅ Guard: only admins should load all invoices
      const adminAccess =
        await loadCurrentAdminAccess();

      const okAdmin =
        canViewAdminTab(
          adminAccess,
          "admin-invoices"
        );
      if (!okAdmin) {
        safeSet(() => {
          setInvoices([]);
          setError(
            "Permission denied. Your administrator profile does not include invoice-view access."
          );
        });
        return;
      }

      // ---------------------------------------------------------
      // A) EXISTING: invoices/ collection (keep as-is)
      // ---------------------------------------------------------
      const refCol = collection(db, "invoices");
      let invoiceDocs = [];

      try {
        const q1 = query(refCol, orderBy("createdAt", "desc"));
        const snap1 = await getDocs(q1);
        invoiceDocs = snap1.docs.map((d) => ({
          id: d.id,
          source: "invoice",
          ...d.data(),
        }));
      } catch (orderErr) {
        const code = String(orderErr?.code || "");

        if (code.includes("permission-denied")) {
          safeSet(() => {
            setInvoices([]);
            setError(
              "Permission denied. Firestore rules blocked invoice access. Confirm invoices rules allow admin reads."
            );
          });
          return;
        }

        console.warn(
          "Invoices load fallback (orderBy createdAt failed):",
          orderErr
        );

        const snap2 = await getDocs(refCol);
        invoiceDocs = snap2.docs.map((d) => ({
          id: d.id,
          source: "invoice",
          ...d.data(),
        }));
      }

      // ---------------------------------------------------------
      // B) Approved timesheets => invoice-like rows (frontend-only)
      // ---------------------------------------------------------
      let timesheetInvoices = [];

      try {
        const tsQ = query(
          collection(db, "timesheets"),
          where("status", "==", "approved"),
          orderBy("approvedAt", "desc")
        );
        const tsSnap = await getDocs(tsQ);
        const timesheets = tsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Cache organisation lookups per shiftId/clientId
        const orgCache = new Map();
        const orgKey = (shiftId, clientId) =>
          `${String(shiftId || "").trim()}__${String(clientId || "").trim()}`;

        // ✅ ADDED: cache shift meta (display id + paid)
        const shiftMetaCache = new Map();

        const built = [];
        for (const ts of timesheets) {
          const shiftId = ts.shiftId || "";
          const clientId =
            ts.clientId ||
            ts.organisationId ||
            ts.organizationId ||
            "";

          const k = orgKey(shiftId, clientId);
          let orgName = orgCache.get(k);
          if (!orgName) {
            orgName = await getOrganisationNameForShift(shiftId, clientId);
            orgCache.set(k, orgName || "");
          }

          // ✅ ADDED: get shift display id + paid flag from shift doc (best effort)
          let shiftMeta = shiftMetaCache.get(String(shiftId || "").trim());
          if (!shiftMeta && shiftId) {
            shiftMeta = await getShiftMeta(shiftId);
            shiftMetaCache.set(String(shiftId || "").trim(), shiftMeta);
          }

          const hours = safeNum(ts.hoursWorkedStaff ?? ts.hoursWorked, 0);
          const rate = safeNum(
            ts.clientRate ??
              ts.billingRate ??
              ts.clientHourlyRate ??
              ts.rateClient,
            0
          );
          const amount = hours * rate;

          const createdAt =
            ts.approvedAt ||
            ts.updatedAt ||
            ts.updatedAtServer ||
            ts.submittedAt ||
            null;

          // ✅ ADDED: paid state from timesheet OR shift (admin can mark either as paid)
          const tsStatusStr = String(ts.status || "").toLowerCase();
          const tsIsPaid =
            tsStatusStr.includes("paid") || ts.paid === true || ts.isPaid === true
              ? true
              : false;

          const shiftIsPaid = shiftMeta?.shiftIsPaid === true;

          const isPaid = tsIsPaid || shiftIsPaid;

          built.push({
            id: `tsinv_${ts.id}`,
            source: "timesheet",

            // ✅ FIX: Always show organisation name (not ts.clientName)
            clientName: orgName || "—",
            clientId: clientId || "",

            invoiceNumber:
              ts.invoiceNumber ||
              ts.invoiceNo ||
              makeInvoiceNoFromTimesheet(ts.id),

            period: ts.period || null,
            amount,

            // keep original field
            status: ts.status || "approved",
            createdAt,

            // ✅ ADDED: paid flag + readable badge label
            isPaid,
            paymentStatus: isPaid ? "paid" : "unpaid",

            // extra for modal
            timesheetId: ts.id,

            // ✅ keep raw shift doc id
            shiftId: shiftId || "",

            // ✅ ADDED: shift display id (SH-000123 / publicId) for UI
            shiftDisplayId: shiftMeta?.shiftDisplayId || "",

            shiftDate: ts.shiftDate || null,
            hoursWorked: hours,
            rate,
            notes: ts.notes || "",
          });
        }

        timesheetInvoices = built;
      } catch (tsErr) {
        console.warn(
          "Approved timesheets load failed (orderBy approvedAt). Trying fallback:",
          tsErr
        );

        try {
          const tsQ2 = query(
            collection(db, "timesheets"),
            where("status", "==", "approved")
          );
          const tsSnap2 = await getDocs(tsQ2);
          const timesheets2 = tsSnap2.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));

          // fallback: no shift enrichment, but also avoid ts.clientName
          timesheetInvoices = timesheets2.map((ts) => {
            const hours = safeNum(ts.hoursWorkedStaff ?? ts.hoursWorked, 0);
            const rate = safeNum(
              ts.clientRate ??
                ts.billingRate ??
                ts.clientHourlyRate ??
                ts.rateClient,
              0
            );
            const amount = hours * rate;

            const createdAt =
              ts.approvedAt ||
              ts.updatedAt ||
              ts.updatedAtServer ||
              ts.submittedAt ||
              null;

            // best-effort organisation name without using ts.clientName
            const orgName =
              ts.organisationName ||
              ts.organizationName ||
              ts.clientOrganisationName ||
              ts.companyName ||
              "—";

            const tsStatusStr = String(ts.status || "").toLowerCase();
            const isPaid =
              tsStatusStr.includes("paid") || ts.paid === true || ts.isPaid === true;

            return {
              id: `tsinv_${ts.id}`,
              source: "timesheet",
              clientName: String(orgName || "—"),
              clientId:
                ts.clientId ||
                ts.organisationId ||
                ts.organizationId ||
                "",
              invoiceNumber:
                ts.invoiceNumber ||
                ts.invoiceNo ||
                makeInvoiceNoFromTimesheet(ts.id),
              period: ts.period || null,
              amount,
              status: ts.status || "approved",
              createdAt,

              // ✅ ADDED
              isPaid: !!isPaid,
              paymentStatus: isPaid ? "paid" : "unpaid",

              timesheetId: ts.id,
              shiftId: ts.shiftId || "",
              shiftDisplayId: "",

              shiftDate: ts.shiftDate || null,
              hoursWorked: hours,
              rate,
              notes: ts.notes || "",
            };
          });
        } catch (tsErr2) {
          console.warn("Approved timesheets fallback also failed:", tsErr2);
          timesheetInvoices = [];
        }
      }

      // ---------------------------------------------------------
      // C) MERGE + DEDUPE
      // ---------------------------------------------------------
      const map = new Map();
      for (const r of invoiceDocs) map.set(r.id, r);
      for (const r of timesheetInvoices) map.set(r.id, r);

      // ✅ ADDED: normalize paid flags for invoiceDocs too (admin can mark invoice as paid)
      const merged = Array.from(map.values()).map((inv) => {
        const isPaid = getIsPaid(inv) || inv.isPaid === true;
        const paymentStatus = isPaid ? "paid" : "unpaid";

        // ✅ ensure shift display id exists for rows that have shiftId
        const shiftDisplayId =
          String(inv.shiftDisplayId || "").trim() ||
          String(inv.shiftPublicId || "").trim() ||
          String(inv.shiftId || "").trim() ||
          "";

        return { ...inv, isPaid, paymentStatus, shiftDisplayId };
      });

      safeSet(() => setInvoices(merged));
    } catch (err) {
      console.error("Error loading invoices:", err);
      const code = String(err?.code || "");
      const msg = code.includes("permission-denied")
        ? "Permission denied. Firestore rules blocked invoice access."
        : "Could not load invoices. Please try again.";

      safeSet(() => {
        setError(msg);
        setInvoices([]);
      });
    } finally {
      safeSet(() => setLoading(false));
    }
  };

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    // ✅ ADDED: range filter first
    const startD = parseRangeStart(rangeStart);
    const endD = parseRangeEnd(rangeEnd);

    // ✅ ADDED: status filter
    const statusFilter = String(sortStatus || "all").toLowerCase();

    const list = invoices.filter((inv) => {
      // status filter
      if (statusFilter !== "all") {
        const paid = inv.isPaid === true || getIsPaid(inv) === true;
        if (statusFilter === "paid" && !paid) return false;
        if (statusFilter === "unpaid" && paid) return false;
      }

      // date range filter
      if (startD || endD) {
        const d = getRowDate(inv);
        if (!d) return false;
        if (startD && d < startD) return false;
        if (endD && d > endD) return false;
      }

      // search
      if (!term) return true;

      const name = String(inv.clientName || "").toLowerCase();
      const period = String(toPeriodLabel(inv) || "").toLowerCase();
      const status = String(inv.status || "").toLowerCase();
      const notes = String(inv.notes || "").toLowerCase();
      const invoiceNo = String(inv.invoiceNumber || inv.invoiceNo || "").toLowerCase();

      // ✅ ADDED: include shift ids in search
      const shiftId = String(inv.shiftId || "").toLowerCase();
      const shiftDisplayId = String(inv.shiftDisplayId || "").toLowerCase();

      return (
        name.includes(term) ||
        period.includes(term) ||
        status.includes(term) ||
        notes.includes(term) ||
        invoiceNo.includes(term) ||
        shiftId.includes(term) ||
        shiftDisplayId.includes(term)
      );
    });

    return list;
  }, [invoices, searchTerm, sortStatus, rangeStart, rangeEnd]);

  // ✅ ADDED: Estimated total (based on current filtered list, so it respects range/status/search)
  const estimatedTotal = useMemo(() => {
    return filteredInvoices.reduce((sum, inv) => sum + safeNum(inv.amount, 0), 0);
  }, [filteredInvoices]);

  const comparePeriod = (a, b) => {
    const aDate =
      asDate(a.createdAt) ||
      asDate(a.issuedAt) ||
      asDate(a.date) ||
      asDate(a.shiftDate);

    const bDate =
      asDate(b.createdAt) ||
      asDate(b.issuedAt) ||
      asDate(b.date) ||
      asDate(b.shiftDate);

    if (aDate && bDate) {
      return sortPeriod === "newest" ? bDate - aDate : aDate - bDate;
    }

    const aP = toPeriodLabel(a) ?? "";
    const bP = toPeriodLabel(b) ?? "";
    const cmp = String(aP).localeCompare(String(bP));
    return sortPeriod === "newest" ? -cmp : cmp;
  };

  const sortedInvoices = useMemo(() => {
    const list = [...filteredInvoices];

    list.sort((a, b) => {
      if (sortClient === "az") {
        const cmp = String(a.clientName || "").localeCompare(String(b.clientName || ""));
        if (cmp !== 0) return cmp;
      } else if (sortClient === "za") {
        const cmp = String(b.clientName || "").localeCompare(String(a.clientName || ""));
        if (cmp !== 0) return cmp;
      }

      // ✅ ADDED: optional secondary sort by status bucket to group paid/unpaid (without changing period sorting)
      const aPaid = a.isPaid === true || getIsPaid(a) === true;
      const bPaid = b.isPaid === true || getIsPaid(b) === true;
      if (sortStatus !== "all" && aPaid !== bPaid) {
        // if filtering, this won't matter; keep stable
      }

      return comparePeriod(a, b);
    });

    return list;
  }, [filteredInvoices, sortClient, sortPeriod, sortStatus]);

  const handleDownloadCSV = () => {
    if (!sortedInvoices.length) return;

    const header = [
      "Client",
      "Invoice No",
      "Shift ID",
      "Period",
      "Amount",
      "Status",
      "Paid",
      "Created",
      "Source",
    ];
    const rows = sortedInvoices.map((inv) => [
      inv.clientName || "",
      String(inv.invoiceNumber || inv.invoiceNo || ""),
      String(inv.shiftDisplayId || inv.shiftId || ""),
      String(toPeriodLabel(inv) || ""),
      typeof inv.amount === "number" ? inv.amount.toFixed(2) : "",
      String(inv.status || ""),
      (inv.isPaid === true || getIsPaid(inv) === true) ? "Paid" : "Unpaid",
      (asDate(inv.createdAt) ||
        asDate(inv.issuedAt) ||
        asDate(inv.date) ||
        asDate(inv.shiftDate))?.toLocaleDateString("en-GB") || "",
      String(inv.source || ""),
    ]);

    const csvContent = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const safe = String(cell ?? "");
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "client_invoices.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Client Invoices</h2>
      <p className="text-xs text-slate-500">
        View and manage invoices raised for client organisations. Search, sort and export for your finance records.
      </p>

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Search:</span>
          <input
            type="text"
            placeholder="Client, invoice no, period, shift id…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs min-w-[160px]"
          />
        </div>

        {/* ✅ ADDED: Date range */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Range:</span>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
            title="Start date"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
            title="End date"
          />
        </div>

        {/* ✅ ADDED: Status filter */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Status:</span>
          <select
            value={sortStatus}
            onChange={(e) => setSortStatus(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
          >
            <option value="all">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Client:</span>
          <select
            value={sortClient}
            onChange={(e) => setSortClient(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
          >
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Period:</span>
          <select
            value={sortPeriod}
            onChange={(e) => setSortPeriod(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={loadInvoices}
            className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-xs font-semibold hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={handleDownloadCSV}
            disabled={!sortedInvoices.length}
            className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* ✅ ADDED: Estimated total (respects current filters: search + range + status) */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs text-slate-700">
        <span className="text-slate-500">Estimated total:</span>{" "}
        <span className="font-semibold">£{estimatedTotal.toFixed(2)}</span>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-600">Loading invoices…</p>
      ) : !sortedInvoices.length ? (
        <p className="text-sm text-slate-600">No invoices found.</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                <th className="p-2 text-left">Client</th>
                <th className="p-2 text-left">Invoice</th>
                {/* ✅ ADDED: Shift ID */}
                <th className="p-2 text-left">Shift ID</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2 text-left">Amount</th>
                {/* ✅ ADDED: Paid badge/status */}
                <th className="p-2 text-left">Paid</th>
                <th className="p-2 text-left">Created</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv) => {
                const paid = inv.isPaid === true || getIsPaid(inv) === true;

                const paidBadgeClass = paid
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200";

                const createdStr =
                  (asDate(inv.createdAt) ||
                    asDate(inv.issuedAt) ||
                    asDate(inv.date) ||
                    asDate(inv.shiftDate))?.toLocaleDateString("en-GB") || "—";

                const shiftDisplay =
                  String(inv.shiftDisplayId || "").trim() ||
                  String(inv.shiftId || "").trim() ||
                  "—";

                return (
                  <tr key={inv.id} className="border-t text-slate-700">
                    <td className="p-2">{inv.clientName || "—"}</td>
                    <td className="p-2">{String(inv.invoiceNumber || inv.invoiceNo || "—")}</td>

                    <td className="p-2">{shiftDisplay}</td>

                    <td className="p-2">{String(toPeriodLabel(inv) || "")}</td>
                    <td className="p-2">
                      {typeof inv.amount === "number" ? `£${inv.amount.toFixed(2)}` : ""}
                    </td>

                    <td className="p-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${paidBadgeClass}`}
                        title={paid ? "Marked as paid" : "Not marked as paid"}
                      >
                        {paid ? "Paid" : "Unpaid"}
                      </span>
                    </td>

                    <td className="p-2">{createdStr}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="text-xs px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50"
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

      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Invoice details</h3>
                <p className="text-xs text-slate-500">
                  Client: <span className="font-semibold">{selectedInvoice.clientName || "—"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <div className="text-xs space-y-1 text-slate-700">
              <p>
                <span className="font-medium">Invoice No:</span>{" "}
                {String(selectedInvoice.invoiceNumber || selectedInvoice.invoiceNo || "—")}
              </p>

              {/* ✅ ADDED: Shift ID in modal */}
              <p>
                <span className="font-medium">Shift ID:</span>{" "}
                {String(
                  selectedInvoice.shiftDisplayId ||
                    selectedInvoice.shiftId ||
                    "—"
                )}
              </p>

              <p>
                <span className="font-medium">Period:</span> {String(toPeriodLabel(selectedInvoice) || "")}
              </p>
              <p>
                <span className="font-medium">Amount:</span>{" "}
                {typeof selectedInvoice.amount === "number"
                  ? `£${selectedInvoice.amount.toFixed(2)}`
                  : "—"}
              </p>

              {/* ✅ ADDED: paid status in modal */}
              <p>
                <span className="font-medium">Paid:</span>{" "}
                {(selectedInvoice.isPaid === true || getIsPaid(selectedInvoice) === true) ? "Yes" : "No"}
              </p>

              <p>
                <span className="font-medium">Created:</span>{" "}
                {(asDate(selectedInvoice.createdAt) ||
                  asDate(selectedInvoice.issuedAt) ||
                  asDate(selectedInvoice.date) ||
                  asDate(selectedInvoice.shiftDate))?.toLocaleString("en-GB") || "—"}
              </p>
              {selectedInvoice.status && (
                <p>
                  <span className="font-medium">Status:</span> {selectedInvoice.status}
                </p>
              )}
              {selectedInvoice.source && (
                <p>
                  <span className="font-medium">Source:</span>{" "}
                  {selectedInvoice.source === "timesheet" ? "Approved timesheet" : "Invoices collection"}
                </p>
              )}
              {selectedInvoice.source === "timesheet" && (
                <>
                  <p>
                    <span className="font-medium">Timesheet ID:</span> {selectedInvoice.timesheetId || "—"}
                  </p>
                  <p>
                    <span className="font-medium">Hours:</span>{" "}
                    {typeof selectedInvoice.hoursWorked === "number" ? selectedInvoice.hoursWorked : "—"}
                  </p>
                  <p>
                    <span className="font-medium">Rate:</span>{" "}
                    {typeof selectedInvoice.rate === "number" ? `£${selectedInvoice.rate.toFixed(2)}` : "—"}
                  </p>
                </>
              )}
              {selectedInvoice.notes && (
                <p>
                  <span className="font-medium">Notes:</span> {selectedInvoice.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
