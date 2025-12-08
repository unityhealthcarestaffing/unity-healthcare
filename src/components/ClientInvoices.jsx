// src/components/ClientInvoices.jsx
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function ClientInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Sorting
  const [sortClient, setSortClient] = useState("az"); // az | za
  const [sortPeriod, setSortPeriod] = useState("newest"); // newest | oldest

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // Modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const ref = collection(db, "invoices");
      const snapshot = await getDocs(ref);
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setInvoices(data);
    } catch (err) {
      console.error("Error loading invoices:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  // Filter by search
  const filteredInvoices = invoices.filter((inv) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      inv.clientName?.toLowerCase().includes(term) ||
      String(inv.period || "").toLowerCase().includes(term)
    );
  });

  // Sort helpers
  const comparePeriod = (a, b) => {
    // Try to use createdAt if present for period ordering
    const aDate = a.createdAt?.toDate?.() || null;
    const bDate = b.createdAt?.toDate?.() || null;

    if (aDate && bDate) {
      if (sortPeriod === "newest") return bDate - aDate;
      if (sortPeriod === "oldest") return aDate - bDate;
    }

    // Fallback to period string/number
    const aP = a.period || "";
    const bP = b.period || "";
    if (typeof aP === "number" && typeof bP === "number") {
      return sortPeriod === "newest" ? bP - aP : aP - bP;
    }
    const cmp = String(aP).localeCompare(String(bP));
    return sortPeriod === "newest" ? -cmp : cmp;
  };

  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    // Primary: client sort
    if (sortClient === "az") {
      const cmp = String(a.clientName || "").localeCompare(
        String(b.clientName || "")
      );
      if (cmp !== 0) return cmp;
    } else if (sortClient === "za") {
      const cmp = String(b.clientName || "").localeCompare(
        String(a.clientName || "")
      );
      if (cmp !== 0) return cmp;
    }

    // Secondary: period/createdAt sort
    return comparePeriod(a, b);
  });

  // CSV export
  const handleDownloadCSV = () => {
    if (!sortedInvoices.length) return;

    const header = ["Client", "Period", "Amount", "Created"];
    const rows = sortedInvoices.map((inv) => [
      inv.clientName || "",
      String(inv.period || ""),
      typeof inv.amount === "number" ? inv.amount.toFixed(2) : "",
      inv.createdAt?.toDate?.().toLocaleDateString() || "",
    ]);

    const csvContent = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const safe = String(cell ?? "");
            // escape quotes
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
        View and manage invoices raised for client organisations. Search, sort
        and export for your finance records.
      </p>

      {/* Controls: search + sort + export */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
        {/* Search */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Search:</span>
          <input
            type="text"
            placeholder="Client or period…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-md bg-white text-xs min-w-[160px]"
          />
        </div>

        {/* Sort by client */}
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
            disabled={!sortedInvoices.length}
            className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* Table */}
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
                <th className="p-2 text-left">Period</th>
                <th className="p-2 text-left">Amount</th>
                <th className="p-2 text-left">Created</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv) => (
                <tr key={inv.id} className="border-t text-slate-700">
                  <td className="p-2">{inv.clientName}</td>
                  <td className="p-2">{String(inv.period || "")}</td>
                  <td className="p-2">
                    {typeof inv.amount === "number"
                      ? `£${inv.amount.toFixed(2)}`
                      : ""}
                  </td>
                  <td className="p-2">
                    {inv.createdAt?.toDate?.().toLocaleDateString()}
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal – Invoice details */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Invoice details
                </h3>
                <p className="text-xs text-slate-500">
                  Client:{" "}
                  <span className="font-semibold">
                    {selectedInvoice.clientName}
                  </span>
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
                <span className="font-medium">Period:</span>{" "}
                {String(selectedInvoice.period || "")}
              </p>
              <p>
                <span className="font-medium">Amount:</span>{" "}
                {typeof selectedInvoice.amount === "number"
                  ? `£${selectedInvoice.amount.toFixed(2)}`
                  : "—"}
              </p>
              <p>
                <span className="font-medium">Created:</span>{" "}
                {selectedInvoice.createdAt?.toDate?.().toLocaleString()}
              </p>
              {selectedInvoice.status && (
                <p>
                  <span className="font-medium">Status:</span>{" "}
                  {selectedInvoice.status}
                </p>
              )}
              {selectedInvoice.notes && (
                <p>
                  <span className="font-medium">Notes:</span>{" "}
                  {selectedInvoice.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
