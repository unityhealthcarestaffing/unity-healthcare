// src/components/Payroll.jsx
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function Payroll() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  // Sorting
  const [sortStaff, setSortStaff] = useState("az"); // az | za
  const [sortPeriod, setSortPeriod] = useState("newest"); // newest | oldest

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // Modal
  const [selectedRecord, setSelectedRecord] = useState(null);

  const loadPayroll = async () => {
    setLoading(true);
    try {
      const ref = collection(db, "payroll");
      const snap = await getDocs(ref);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecords(data);
    } catch (err) {
      console.error("Error loading payroll:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayroll();
  }, []);

  const filtered = records.filter((rec) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      rec.staffName?.toLowerCase().includes(term) ||
      String(rec.period || "").toLowerCase().includes(term)
    );
  });

  const comparePeriod = (a, b) => {
    const aDate = a.createdAt?.toDate?.() || null;
    const bDate = b.createdAt?.toDate?.() || null;

    if (aDate && bDate) {
      if (sortPeriod === "newest") return bDate - aDate;
      if (sortPeriod === "oldest") return aDate - bDate;
    }

    const aP = a.period || "";
    const bP = b.period || "";
    if (typeof aP === "number" && typeof bP === "number") {
      return sortPeriod === "newest" ? bP - aP : aP - bP;
    }
    const cmp = String(aP).localeCompare(String(bP));
    return sortPeriod === "newest" ? -cmp : cmp;
  };

  const sorted = [...filtered].sort((a, b) => {
    // Staff sort
    if (sortStaff === "az") {
      const cmp = String(a.staffName || "").localeCompare(
        String(b.staffName || "")
      );
      if (cmp !== 0) return cmp;
    } else if (sortStaff === "za") {
      const cmp = String(b.staffName || "").localeCompare(
        String(a.staffName || "")
      );
      if (cmp !== 0) return cmp;
    }

    // Period / createdAt
    return comparePeriod(a, b);
  });

  const handleDownloadCSV = () => {
    if (!sorted.length) return;

    const header = ["Staff", "Period", "Total Pay", "Created"];
    const rows = sorted.map((rec) => [
      rec.staffName || "",
      String(rec.period || ""),
      typeof rec.totalPay === "number" ? rec.totalPay.toFixed(2) : "",
      rec.createdAt?.toDate?.().toLocaleDateString() || "",
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
      <h2 className="text-lg font-semibold text-slate-900">Payroll</h2>
      <p className="text-xs text-slate-500">
        Review staff pay records by period. Search, sort and export for finance.
      </p>

      {/* Controls: search + sort + export */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        {/* Search */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Search:</span>
          <input
            type="text"
            placeholder="Staff or period…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs min-w-[160px]"
          />
        </div>

        {/* Sort by staff */}
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

        {/* Sort by period */}
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

        {/* Export */}
        <div className="ml-auto">
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

      {/* Table */}
      {loading ? (
        <p className="text-sm text-slate-600">Loading payroll records…</p>
      ) : !sorted.length ? (
        <p className="text-sm text-slate-600">No payroll records found.</p>
      ) : (
        <div className="overflow-x-auto bg-white border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                <th className="p-2 text-left">Staff</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2 text-left">Total Pay</th>
                <th className="p-2 text-left">Created</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((rec) => (
                <tr key={rec.id} className="border-t text-slate-700">
                  <td className="p-2">{rec.staffName}</td>
                  <td className="p-2">{String(rec.period || "")}</td>
                  <td className="p-2">
                    {typeof rec.totalPay === "number"
                      ? `£${rec.totalPay.toFixed(2)}`
                      : ""}
                  </td>
                  <td className="p-2">
                    {rec.createdAt?.toDate?.().toLocaleDateString()}
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

      {/* Modal – Payroll details */}
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
                    {selectedRecord.staffName}
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
                {String(selectedRecord.period || "")}
              </p>
              <p>
                <span className="font-medium">Total pay:</span>{" "}
                {typeof selectedRecord.totalPay === "number"
                  ? `£${selectedRecord.totalPay.toFixed(2)}`
                  : "—"}
              </p>
              <p>
                <span className="font-medium">Created:</span>{" "}
                {selectedRecord.createdAt?.toDate?.().toLocaleString()}
              </p>
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
