// src/components/Payroll.jsx
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

export default function Payroll() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Sorting
  const [sortStaff, setSortStaff] = useState("az"); // az | za
  const [sortPeriod, setSortPeriod] = useState("newest"); // newest | oldest

  // ✅ ADDED: period range filter (YYYY-MM-DD)
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // ✅ ADDED: cache shift docId -> public shift code (e.g. SH-000123)
  const [shiftCodeCache, setShiftCodeCache] = useState({});

  // Modal
  const [selectedRecord, setSelectedRecord] = useState(null);

  // prevent state updates after unmount
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

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

  const toPeriodLabel = (rec) => {
    // Keep your existing period if present
    if (rec?.period) return String(rec.period);

    // Otherwise build a simple period label from shiftDate / approvedAt
    const d = asDate(rec.shiftDate) || asDate(rec.createdAt) || asDate(rec.approvedAt);
    if (!d) return "—";
    const month = d.toLocaleString("en-GB", { month: "short" });
    const year = d.getFullYear();
    return `${month} ${year}`;
  };

  const safeNum = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const computeTimesheetPay = (ts) => {
    const hours = safeNum(ts.hoursWorkedStaff ?? ts.hoursWorked, 0);
    const rate = safeNum(ts.staffRate ?? ts.rateStaff ?? ts.staffHourlyRate, 0);
    const totalPay = hours * rate;
    return { hours, rate, totalPay };
  };

  // ✅ ADDED: normalize & resolve a public shift code everywhere
  const safeStr = (v) => (v == null ? "" : String(v));

  // Prefer a true public code field if present on record
  const getPublicShiftCodeFromRecord = (rec) => {
    const direct =
      safeStr(rec.shiftPublicId).trim() ||
      safeStr(rec.shiftPublicID).trim() ||
      safeStr(rec.shiftCode).trim() ||
      safeStr(rec.shiftRef).trim() ||
      "";

    // If shiftId already looks like SH-000123, accept it as public code
    const sid = safeStr(rec.shiftId).trim();
    if (!direct && /^SH-\d{6}$/i.test(sid)) return sid.toUpperCase();

    return direct ? direct.toUpperCase() : "";
  };

  // If we only have a Firestore shift DOC id, use cache lookup
  const getShiftDocIdFromRecord = (rec) => {
    const sid = safeStr(rec.shiftId).trim();
    if (!sid) return "";
    // If it’s already a public code, it’s not a doc id
    if (/^SH-\d{6}$/i.test(sid)) return "";
    return sid;
  };

  const getShiftDisplayCode = (rec) => {
    const direct = getPublicShiftCodeFromRecord(rec);
    if (direct) return direct;

    const docId = getShiftDocIdFromRecord(rec);
    if (docId && shiftCodeCache[docId]) return shiftCodeCache[docId];

    return "—";
  };

  // ✅ ADDED: choose a stable date for filtering/sorting by period range
  const getRecordDate = (rec) =>
    asDate(rec.createdAt) || asDate(rec.approvedAt) || asDate(rec.shiftDate) || null;

  const loadPayroll = async () => {
    setLoading(true);
    setLoadError("");

    try {
      // ---------------------------------------------------------
      // A) EXISTING: payroll/ collection (keep as-is)
      // ---------------------------------------------------------
      const payrollRef = collection(db, "payroll");

      // Load every payroll document. Sorting by createdAt here would
      // exclude older documents that do not contain that field.
      const payrollSnap = await getDocs(payrollRef);
      const payrollData = payrollSnap.docs.map((d) => ({
        id: d.id,
        source: "payroll",
        ...d.data(),
      }));

      // ---------------------------------------------------------
      // B) NEW: approved timesheets => payroll-like rows
      // ---------------------------------------------------------
      // Note: where + orderBy requires an index in Firestore sometimes.
      // If index error occurs, create the suggested index in Firebase console.
      const tsRef = collection(db, "timesheets");

      let timesheetData = [];
      try {
        // Load first, then filter and sort locally. This preserves approved
        // legacy timesheets that may not contain approvedAt.
        const tsSnap = await getDocs(tsRef);

        const timesheets = tsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (ts) =>
              String(ts.status || "")
                .trim()
                .toLowerCase() === "approved"
          )
          .sort((a, b) => {
            const aDate =
              asDate(a.approvedAt) ||
              asDate(a.updatedAt) ||
              asDate(a.updatedAtServer) ||
              asDate(a.submittedAt) ||
              asDate(a.createdAt);

            const bDate =
              asDate(b.approvedAt) ||
              asDate(b.updatedAt) ||
              asDate(b.updatedAtServer) ||
              asDate(b.submittedAt) ||
              asDate(b.createdAt);

            return (bDate?.getTime?.() || 0) - (aDate?.getTime?.() || 0);
          });

        // cache staff lookup (avoid repeated reads)
        const staffCache = new Map();

        const getStaffName = async (uid, fallbackEmail) => {
          if (!uid) return fallbackEmail || "—";
          if (staffCache.has(uid)) return staffCache.get(uid);

          try {
            const uSnap = await getDoc(doc(db, "users", uid));
            const u = uSnap.exists() ? uSnap.data() : {};
            const name =
              u.fullName ||
              u.name ||
              u.displayName ||
              u.email ||
              fallbackEmail ||
              "—";
            staffCache.set(uid, name);
            return name;
          } catch {
            const name = fallbackEmail || "—";
            staffCache.set(uid, name);
            return name;
          }
        };

        const built = [];
        for (const ts of timesheets) {
          const staffId = ts.staffId || ts.uid || ts.bookedBy || null;
          const fallbackEmail = ts.staffEmail || ts.email || null;
          const staffName =
            ts.staffName ||
            ts.bookedStaffName ||
            (await getStaffName(staffId, fallbackEmail));

          const { totalPay } = computeTimesheetPay(ts);

          built.push({
            // stable ID to dedupe (timesheet-based)
            id: `ts_${ts.id}`,
            source: "timesheet",
            timesheetId: ts.id,

            // keep your existing fields expected by UI
            staffName: staffName || "—",
            period: null, // derived in toPeriodLabel()
            totalPay,

            createdAt:
              ts.approvedAt ||
              ts.updatedAt ||
              ts.updatedAtServer ||
              ts.submittedAt ||
              null,

            // extra fields for view modal (safe)
            approvedAt: ts.approvedAt || null,

            // ✅ keep raw shift identifiers
            shiftId: ts.shiftId || null,

            // ✅ keep public code if timesheet already stores it
            shiftPublicId:
              ts.shiftPublicId ||
              ts.shiftPublicID ||
              ts.shiftCode ||
              ts.shiftRef ||
              null,

            shiftDate: ts.shiftDate || null,
            hoursWorked: safeNum(ts.hoursWorkedStaff ?? ts.hoursWorked, 0),
            staffRate: safeNum(ts.staffRate ?? ts.rateStaff, 0),
            notes: ts.notes || null,
          });
        }

        timesheetData = built;
      } catch (err) {
        console.error("Error loading approved timesheets for payroll:", err);
        setLoadError(
          "Approved timesheets could not be loaded. Existing payroll records are shown where available."
        );
        timesheetData = [];
      }

      // ---------------------------------------------------------
      // C) MERGE + DEDUPE (no duplicates)
      // ---------------------------------------------------------
      const map = new Map();

      // First: timesheets (so they appear even if payroll/ is empty)
      for (const r of timesheetData) map.set(r.id, r);

      // Then: payroll docs (if you already have payroll records, keep them too)
      for (const r of payrollData) {
        // If a payroll record already exists with same id, keep payroll version
        map.set(r.id, r);
      }

      const merged = Array.from(map.values());

      if (!aliveRef.current) return;
      setRecords(merged);
    } catch (err) {
      console.error("Error loading payroll:", err);
      if (!aliveRef.current) return;
      setLoadError(
        "Payroll records could not be loaded. Please refresh or check administrator access."
      );
      setRecords([]);
    } finally {
      if (!aliveRef.current) return;
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ resolve missing public shift codes by reading shifts/{docId} once
  useEffect(() => {
    const run = async () => {
      if (!records.length) return;

      // build list of doc ids we need to resolve
      const needed = [];
      for (const rec of records) {
        const already = getPublicShiftCodeFromRecord(rec);
        if (already) continue;

        const docId = getShiftDocIdFromRecord(rec);
        if (!docId) continue;

        if (shiftCodeCache[docId]) continue;
        needed.push(docId);
      }

      const unique = Array.from(new Set(needed));
      if (!unique.length) return;

      const updates = {};
      for (const docId of unique) {
        try {
          const sSnap = await getDoc(doc(db, "shifts", docId));
          if (!sSnap.exists()) continue;
          const s = sSnap.data() || {};

          const code =
            safeStr(s.shiftId).trim() || // commonly SH-000123
            safeStr(s.publicId).trim() ||
            safeStr(s.shiftPublicId).trim() ||
            safeStr(s.shiftCode).trim() ||
            "";

          if (code) updates[docId] = code.toUpperCase();
        } catch (e) {
          console.warn("Could not resolve shift public code for:", docId, e);
        }
      }

      if (Object.keys(updates).length) {
        if (!aliveRef.current) return;
        setShiftCodeCache((prev) => ({ ...prev, ...updates }));
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  // ✅ ADDED: range + search filter (keeps existing behaviour)
  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    // build range bounds
    const fromD = periodFrom ? new Date(periodFrom) : null;
    const toD = periodTo ? new Date(periodTo) : null;
    if (fromD) fromD.setHours(0, 0, 0, 0);
    if (toD) toD.setHours(23, 59, 59, 999);

    return records.filter((rec) => {
      // Range filter
      if (fromD || toD) {
        const d = getRecordDate(rec);
        if (!d) return false;
        if (fromD && d < fromD) return false;
        if (toD && d > toD) return false;
      }

      // Search filter
      if (!term) return true;

      const name = String(rec.staffName || "").toLowerCase();
      const period = String(toPeriodLabel(rec) || "").toLowerCase();
      const src = String(rec.source || "").toLowerCase();
      const shiftCode = String(getShiftDisplayCode(rec) || "").toLowerCase();

      return (
        name.includes(term) ||
        period.includes(term) ||
        src.includes(term) ||
        shiftCode.includes(term)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, searchTerm, periodFrom, periodTo, shiftCodeCache]);

  const comparePeriod = (a, b) => {
    const aDate = getRecordDate(a);
    const bDate = getRecordDate(b);

    if (aDate && bDate) {
      return sortPeriod === "newest" ? bDate - aDate : aDate - bDate;
    }

    const aP = toPeriodLabel(a) ?? "";
    const bP = toPeriodLabel(b) ?? "";
    const cmp = String(aP).localeCompare(String(bP));
    return sortPeriod === "newest" ? -cmp : cmp;
  };

  const sorted = useMemo(() => {
    const list = [...filtered];

    list.sort((a, b) => {
      // Staff sort
      const aName = String(a.staffName || "");
      const bName = String(b.staffName || "");

      if (sortStaff === "az") {
        const cmp = aName.localeCompare(bName);
        if (cmp !== 0) return cmp;
      } else {
        const cmp = bName.localeCompare(aName);
        if (cmp !== 0) return cmp;
      }

      // Period / createdAt sort
      return comparePeriod(a, b);
    });

    return list;
  }, [filtered, sortStaff, sortPeriod]);

  // ✅ ADDED: Estimated total (based on the CURRENT filtered+sorted list)
  const estimatedTotal = useMemo(() => {
    return sorted.reduce((sum, r) => {
      const n = Number(r.totalPay);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [sorted]);

  const handleDownloadCSV = () => {
    if (!sorted.length) return;

    // include public shift code in export
    const header = ["Staff", "Period", "Shift", "Total Pay", "Created", "Source"];
    const rows = sorted.map((rec) => [
      rec.staffName || "",
      toPeriodLabel(rec),
      getShiftDisplayCode(rec),
      typeof rec.totalPay === "number" ? rec.totalPay.toFixed(2) : "",
      getRecordDate(rec)?.toLocaleDateString() || "",
      rec.source || "",
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
    link.setAttribute("download", "payroll.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {loadError}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Payroll</h2>
          <p className="text-xs text-slate-500">
            Review staff pay records by period. Search, sort and export for finance.
          </p>
        </div>

        {/* ✅ ADDED: Estimated total */}
        {!loading && sorted.length > 0 && (
          <div className="text-right">
            <div className="text-[11px] text-slate-500">Estimated total</div>
            <div className="text-base font-bold text-slate-900">
              £{estimatedTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Search:</span>
          <input
            type="text"
            placeholder="Staff, period or SH-000123…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs min-w-[160px]"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Staff:</span>
          <select
            value={sortStaff}
            onChange={(e) => setSortStaff(e.target.value)}
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

        {/* ✅ ADDED: Range filter controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Range:</span>
          <input
            type="date"
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs"
          />
          {(periodFrom || periodTo) && (
            <button
              type="button"
              onClick={() => {
                setPeriodFrom("");
                setPeriodTo("");
              }}
              className="text-[11px] px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50"
              title="Clear range"
            >
              Clear
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={loadPayroll}
            className="px-3 py-1.5 rounded-full border border-slate-300 text-xs font-semibold hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={handleDownloadCSV}
            disabled={!sorted.length}
            className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Loading payroll records…</p>
      ) : !sorted.length ? (
        <p className="text-sm text-slate-600">
          No payroll records found (approved timesheets will appear here once approved).
        </p>
      ) : (
        <div className="overflow-x-auto bg-white border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                <th className="p-2 text-left">Staff</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2 text-left">Shift ID</th>
                <th className="p-2 text-left">Total Pay</th>
                <th className="p-2 text-left">Created</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((rec) => (
                <tr key={rec.id} className="border-t text-slate-700">
                  <td className="p-2">{rec.staffName || "—"}</td>
                  <td className="p-2">{toPeriodLabel(rec)}</td>
                  <td className="p-2 font-mono text-xs">{getShiftDisplayCode(rec)}</td>
                  <td className="p-2">
                    {typeof rec.totalPay === "number"
                      ? `£${rec.totalPay.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="p-2">
                    {getRecordDate(rec)?.toLocaleDateString() || "—"}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRecord(rec)}
                      className="text-xs px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedRecord && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Payroll record
                </h3>
                <p className="text-xs text-slate-500">
                  Staff:{" "}
                  <span className="font-semibold">
                    {selectedRecord.staffName || "—"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <div className="text-xs space-y-1 text-slate-700">
              <p>
                <span className="font-medium">Period:</span>{" "}
                {toPeriodLabel(selectedRecord)}
              </p>

              <p>
                <span className="font-medium">Shift ID:</span>{" "}
                <span className="font-mono">{getShiftDisplayCode(selectedRecord)}</span>
              </p>

              <p>
                <span className="font-medium">Total pay:</span>{" "}
                {typeof selectedRecord.totalPay === "number"
                  ? `£${selectedRecord.totalPay.toFixed(2)}`
                  : "—"}
              </p>

              <p>
                <span className="font-medium">Created:</span>{" "}
                {getRecordDate(selectedRecord)?.toLocaleString("en-GB") || "—"}
              </p>

              {/* extra details if it came from timesheet */}
              {selectedRecord.source === "timesheet" && (
                <>
                  <p>
                    <span className="font-medium">Source:</span> Approved timesheet
                  </p>
                  <p>
                    <span className="font-medium">Timesheet ID:</span>{" "}
                    {selectedRecord.timesheetId || "—"}
                  </p>

                  {/* keep original raw value visible for debugging without changing main display */}
                  <p className="text-[11px] text-slate-500">
                    Raw shift reference: {safeStr(selectedRecord.shiftId || "—")}
                  </p>

                  <p>
                    <span className="font-medium">Hours:</span>{" "}
                    {typeof selectedRecord.hoursWorked === "number"
                      ? selectedRecord.hoursWorked
                      : "—"}
                  </p>
                  <p>
                    <span className="font-medium">Rate:</span>{" "}
                    {typeof selectedRecord.staffRate === "number"
                      ? `£${selectedRecord.staffRate.toFixed(2)}`
                      : "—"}
                  </p>
                </>
              )}

              {selectedRecord.notes && (
                <p>
                  <span className="font-medium">Notes:</span>{" "}
                  {selectedRecord.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
