// src/components/AdminClients.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  Users,
  FileSearch,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
} from "lucide-react";

export default function AdminClients({ currentUser }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Sort state
  const [sortBy, setSortBy] = useState("createdAt"); // "client" | "status" | "createdAt"
  const [sortDirection, setSortDirection] = useState("desc"); // "asc" | "desc"

  const loadClients = async () => {
    setLoading(true);
    setError("");

    try {
      const ref = collection(db, "clients");
      const q = query(ref, orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setClients(data);
    } catch (err) {
      console.error("Error loading clients:", err);
      setError("Could not load client records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  const toggleActive = async (client) => {
    if (!currentUser) return;

    const willActivate = !client.isActive;
    const confirmMsg = willActivate
      ? `Activate client "${client.organisationName || client.tradingName || client.contactName || client.email}"?`
      : `Deactivate this client? They will no longer be able to post shifts.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSavingId(client.id);
      const clientRef = doc(db, "clients", client.id);

      await updateDoc(clientRef, {
        isActive: willActivate,
        activatedAt: willActivate ? new Date() : null,
        activatedBy: willActivate ? currentUser.uid : null,
        status: willActivate ? "active" : "inactive",
      });

      await loadClients();
    } catch (err) {
      console.error("Error updating client status:", err);
      alert("Could not change client status.");
    } finally {
      setSavingId(null);
    }
  };

  // Helper display fields
  const getDisplayName = (c) =>
    c.organisationName ||
    c.tradingName ||
    c.contactName ||
    c.email ||
    "Unnamed client";

  const getDisplayAddress = (c) =>
    c.organisationAddress || c.invoiceAddress || "";
  const getDisplayPostcode = (c) => c.organisationPostcode || "";
  const getDisplayLandmark = (c) => c.landmark || c.cityTown || "";

  const getStatusBadge = (c) => {
    const s = (c.status || "").toLowerCase();
    if (c.isActive || s === "active") {
      return {
        label: "Active",
        className:
          "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };
    }
    if (s === "pending" || s === "new") {
      return {
        label: "Pending",
        className:
          "bg-amber-50 text-amber-700 border border-amber-200",
      };
    }
    return {
      label: "Inactive",
      className: "bg-slate-50 text-slate-700 border border-slate-200",
    };
  };

  // Filter + sort
  const filteredAndSorted = useMemo(() => {
    let list = [...clients];

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter((c) => {
        const name = getDisplayName(c).toLowerCase();
        const email = (c.email || "").toLowerCase();
        const type = (c.clientType || "").toLowerCase();
        const org = (c.organisationName || "").toLowerCase();
        return (
          name.includes(term) ||
          email.includes(term) ||
          type.includes(term) ||
          org.includes(term)
        );
      });
    }

    // Filter by status
    if (statusFilter !== "all") {
      list = list.filter((c) => {
        const s = (c.status || "").toLowerCase();
        if (statusFilter === "active") {
          return c.isActive || s === "active";
        }
        if (statusFilter === "pending") {
          return s === "pending" || s === "new";
        }
        if (statusFilter === "inactive") {
          return !c.isActive && s === "inactive";
        }
        return true;
      });
    }

    // Sort
    list.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortBy === "client") {
        aVal = getDisplayName(a).toLowerCase();
        bVal = getDisplayName(b).toLowerCase();
      } else if (sortBy === "status") {
        aVal = (a.status || "").toLowerCase();
        bVal = (b.status || "").toLowerCase();
      } else {
        // createdAt as date
        const aDate =
          a.createdAt?.toDate?.() || a.activatedAt?.toDate?.() || null;
        const bDate =
          b.createdAt?.toDate?.() || b.activatedAt?.toDate?.() || null;
        aVal = aDate ? aDate.getTime() : 0;
        bVal = bDate ? bDate.getTime() : 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [clients, searchTerm, statusFilter, sortBy, sortDirection]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-9 w-9 rounded-2xl bg-cyan-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                Admin – Clients
              </h2>
              <p className="text-xs text-slate-500">
                Review onboarding details, verify documents and control client
                access.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
          <span>
            Total clients:{" "}
            <span className="font-semibold text-slate-800">
              {clients.length}
            </span>
          </span>
          <span>
            Active:{" "}
            <span className="font-semibold text-emerald-700">
              {clients.filter((c) => c.isActive).length}
            </span>
          </span>
        </div>
      </div>

      {/* Filters row */}
      <div className="card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <FileSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by client name, email or type…"
              className="input pl-8 text-xs"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-32"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Sort controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-500">Sort by</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-32"
          >
            <option value="client">Client</option>
            <option value="status">Status</option>
            <option value="createdAt">Created date</option>
          </select>
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-32"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading clients…
        </div>
      ) : !filteredAndSorted.length ? (
        <div className="card text-sm text-slate-600">
          No clients found. Adjust your filters or search term.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Client
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Type
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Email
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Address
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Postcode
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Landmark
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Status
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Created
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Activated
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Docs
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((client, idx) => {
                const statusBadge = getStatusBadge(client);
                const createdDate = client.createdAt?.toDate
                  ? client.createdAt.toDate().toLocaleDateString()
                  : "—";
                const activatedDate = client.activatedAt?.toDate
                  ? client.activatedAt.toDate().toLocaleDateString()
                  : "—";

                const docs = Array.isArray(client.documents)
                  ? client.documents
                  : [];

                return (
                  <tr
                    key={client.id}
                    className={`border-b border-slate-100 ${
                      idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-slate-900">
                        {getDisplayName(client)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        UID: {client.uid || client.id}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {client.clientType || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {client.email || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {getDisplayAddress(client) || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {getDisplayPostcode(client) || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {getDisplayLandmark(client) || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {createdDate}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {activatedDate}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-600">
                      {docs.length ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px]">
                            {docs.length} file{docs.length > 1 ? "s" : ""}
                          </span>
                          {docs[0]?.url && (
                            <a
                              href={docs[0].url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-[11px] text-cyan-700 hover:text-cyan-900 underline"
                            >
                              View latest
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          None
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => toggleActive(client)}
                        disabled={savingId === client.id}
                        className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
                          client.isActive
                            ? "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
                            : "bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-700"
                        } disabled:opacity-60`}
                      >
                        {savingId === client.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : client.isActive ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        <span>
                          {client.isActive ? "Deactivate" : "Activate"}
                        </span>
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
  );
}
