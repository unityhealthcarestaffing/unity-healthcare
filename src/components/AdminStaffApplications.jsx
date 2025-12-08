// src/components/AdminStaffApplications.jsx
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

function formatDate(ts) {
  if (!ts) return "—";
  try {
    if (ts.toDate) return ts.toDate().toLocaleDateString("en-GB");
    if (ts.seconds) {
      return new Date(ts.seconds * 1000).toLocaleDateString("en-GB");
    }
  } catch (e) {
    // ignore
  }
  return "—";
}

function formatDateTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
    return d.toLocaleString("en-GB");
  } catch (e) {
    return "—";
  }
}

export default function AdminStaffApplications({ currentUser }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("any");
  const [sortBy, setSortBy] = useState("newest");

  const [selectedApp, setSelectedApp] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const loadApplications = async () => {
    setLoading(true);
    setError("");
    try {
      const ref = collection(db, "staffApplications");
      const q = query(ref, orderBy("submittedAt", "desc"));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setApplications(data);
      if (!selectedApp && data.length) {
        setSelectedApp(data[0]);
      }
    } catch (err) {
      console.error("Error loading staff applications:", err);
      setError("Could not load staff applications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChangeStatus = async (app, newStatus) => {
    if (!app) return;
    if (!window.confirm(`Change status to "${newStatus}"?`)) return;

    try {
      setUpdatingStatus(true);
      const ref = doc(db, "staffApplications", app.id);
      await updateDoc(ref, { status: newStatus });

      // Update local state
      setApplications((prev) =>
        prev.map((a) =>
          a.id === app.id ? { ...a, status: newStatus } : a
        )
      );
      setSelectedApp((prev) =>
        prev && prev.id === app.id ? { ...prev, status: newStatus } : prev
      );
    } catch (err) {
      console.error("Error updating application status:", err);
      alert("Could not update status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Derived visible list after filters & sorting
  const visibleApps = applications
    .filter((app) => {
      if (statusFilter !== "all" && (app.status || "pending") !== statusFilter) {
        return false;
      }
      if (roleFilter !== "any" && (app.role || "") !== roleFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const name = (app.fullName || "").toLowerCase();
        const email = (app.email || "").toLowerCase();
        return name.includes(term) || email.includes(term);
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = a.submittedAt?.seconds || 0;
      const bTime = b.submittedAt?.seconds || 0;
      if (sortBy === "oldest") return aTime - bTime;
      // default newest first
      return bTime - aTime;
    });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Staff Applications
        </h3>
        <p className="text-xs text-slate-500">
          Review new applicants, check documents and update their status.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center text-xs">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Search:</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Name or email…"
            className="input !py-1.5 !px-3 !text-xs !rounded-full w-48"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-slate-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input !py-1.5 !px-3 !text-xs !rounded-full"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-slate-500">Role:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="input !py-1.5 !px-3 !text-xs !rounded-full"
          >
            <option value="any">Any</option>
            <option value="Support Worker">Support Worker</option>
            <option value="HCA">HCA</option>
            <option value="Nurse">Nurse</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-slate-500">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input !py-1.5 !px-3 !text-xs !rounded-full"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Name
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Email
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Role
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Experience
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Submitted
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      Loading applications…
                    </td>
                  </tr>
                ) : !visibleApps.length ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      No applications match your filters.
                    </td>
                  </tr>
                ) : (
                  visibleApps.map((app) => {
                    const isSelected = selectedApp?.id === app.id;
                    const status = app.status || "pending";

                    let statusClass =
                      "bg-slate-50 text-slate-700 border border-slate-200";
                    if (status === "pending") {
                      statusClass =
                        "bg-amber-50 text-amber-700 border border-amber-200";
                    } else if (status === "approved") {
                      statusClass =
                        "bg-emerald-50 text-emerald-700 border border-emerald-200";
                    } else if (status === "rejected") {
                      statusClass =
                        "bg-rose-50 text-rose-700 border border-rose-200";
                    }

                    const experienceDisplay =
                      app.experienceSummary ||
                      (app.experienceMonths
                        ? `${app.experienceMonths} months`
                        : "—");

                    return (
                      <tr
                        key={app.id}
                        className={`border-b border-slate-100 ${
                          isSelected ? "bg-cyan-50/40" : ""
                        }`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {app.fullName || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {app.email || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {app.role || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {experienceDisplay}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusClass}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(app.submittedAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedApp(app)}
                            className="px-3 py-1 rounded-full border border-slate-300 bg-white text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details panel */}
        <div className="card text-xs space-y-2">
          {selectedApp ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    {selectedApp.role || "Applicant"}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    {selectedApp.fullName || "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  className="text-[11px] text-slate-400 hover:text-slate-600"
                >
                  Close
                </button>
              </div>

              <div className="border-t border-slate-100 pt-2 space-y-1">
                <p>
                  <span className="font-semibold text-slate-700">
                    Email:
                  </span>{" "}
                  {selectedApp.email || "—"}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">
                    Phone:
                  </span>{" "}
                  {selectedApp.phone || "—"}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">
                    Experience:
                  </span>{" "}
                  {selectedApp.experienceSummary ||
                    (selectedApp.experienceMonths
                      ? `${selectedApp.experienceMonths} months`
                      : "—")}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">
                    Status:
                  </span>{" "}
                  {selectedApp.status || "pending"}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">
                    Submitted:
                  </span>{" "}
                  {formatDateTime(selectedApp.submittedAt)}
                </p>
              </div>

              {/* NEW: Documents section */}
              <div className="border-t border-slate-100 pt-2 mt-2">
                <h5 className="text-xs font-semibold text-slate-800">
                  Documents
                </h5>
                {Array.isArray(selectedApp.documents) &&
                selectedApp.documents.length ? (
                  <ul className="mt-1 space-y-1">
                    {selectedApp.documents.map((docItem, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-2 text-[11px] bg-slate-50 rounded-md px-2 py-1"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-800">
                            {docItem.name || `Document ${idx + 1}`}
                          </span>
                          {docItem.type && (
                            <span className="text-slate-500">
                              {docItem.type}
                            </span>
                          )}
                          {docItem.uploadedAt && (
                            <span className="text-slate-400">
                              Uploaded: {formatDateTime(docItem.uploadedAt)}
                            </span>
                          )}
                        </div>
                        {docItem.url && (
                          <a
                            href={docItem.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-700 hover:text-cyan-800 font-semibold"
                          >
                            Open
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">
                    No documents uploaded.
                  </p>
                )}
              </div>

              {/* Status actions */}
              <div className="border-t border-slate-100 pt-3 mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleChangeStatus(selectedApp, "approved")}
                  className="px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleChangeStatus(selectedApp, "rejected")}
                  className="px-3 py-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 disabled:opacity-60"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleChangeStatus(selectedApp, "pending")}
                  className="px-3 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  Mark as pending
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Select an application from the table to view details and
              documents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
