// src/components/AdminUsers.jsx
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

function statusBadgeClasses(status) {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-800 border border-amber-200";
    case "active":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "disabled":
      return "bg-slate-200 text-slate-700 border border-slate-300";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("pending");

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(data);
    } catch (err) {
      console.error("Error loading users:", err);
      setError("Could not load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleUpdateStatus = async (userId, newStatus, newActive) => {
    try {
      setUpdatingId(userId);
      const ref = doc(db, "users", userId);
      await updateDoc(ref, {
        status: newStatus,
        isActive: newActive,
      });
      await loadUsers();
    } catch (err) {
      console.error("Error updating user:", err);
      alert("Could not update user status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterStatus === "pending" && u.status !== "pending") return false;
    if (filterStatus === "active" && u.status !== "active") return false;
    if (filterStatus === "disabled" && u.status !== "disabled") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base md:text-lg font-semibold text-slate-900">
          Admin – User Approvals
        </h2>
        <p className="text-xs md:text-sm text-slate-600">
          Review new staff and client registrations. Approve or deactivate access.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 text-xs md:text-sm">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Role:</span>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
          >
            <option value="all">All</option>
            <option value="staff">Staff</option>
            <option value="client">Client</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-slate-500">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
          >
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Loading users…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !filteredUsers.length ? (
        <p className="text-sm text-slate-600">
          No users match the current filters.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredUsers.map((u) => {
            const isStaff = u.role === "staff";
            const isClient = u.role === "client";

            return (
              <div
                key={u.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm text-xs md:text-sm space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">
                      {isClient
                        ? u.organisationName || "Client"
                        : u.fullName || "Staff"}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      {u.email}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Role:{" "}
                      <span className="font-semibold uppercase">
                        {u.role || "n/a"}
                      </span>
                    </p>
                  </div>
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                      statusBadgeClasses(u.status)
                    }
                  >
                    {u.status || "—"}
                  </span>
                </div>

                <div className="text-[11px] text-slate-600 space-y-0.5 mt-1">
                  {isClient && (
                    <>
                      {u.organisationAddress && (
                        <p>{u.organisationAddress}</p>
                      )}
                      {u.organisationPostcode && (
                        <p>{u.organisationPostcode}</p>
                      )}
                    </>
                  )}
                  {isStaff && (
                    <>
                      {u.homeAddress && <p>{u.homeAddress}</p>}
                      {u.postcode && <p>{u.postcode}</p>}
                    </>
                  )}
                  {u.phone && <p>Phone: {u.phone}</p>}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={updatingId === u.id}
                    onClick={() =>
                      handleUpdateStatus(u.id, "active", true)
                    }
                    className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    Approve / Activate
                  </button>

                  <button
                    type="button"
                    disabled={updatingId === u.id}
                    onClick={() =>
                      handleUpdateStatus(u.id, "disabled", false)
                    }
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    Disable
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
