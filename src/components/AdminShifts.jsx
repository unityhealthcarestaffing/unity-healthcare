// src/components/AdminShifts.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  updateDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  CalendarDays,
  Loader2,
  ArrowUpDown,
  ListFilter,
  Users,
  Pencil,
  XCircle,
  CheckCircle2,
} from "lucide-react";

export default function AdminShifts({ currentUser }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("");

  // Sort state: "date" | "client" | "status"
  const [sortBy, setSortBy] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc"); // "asc" | "desc"

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    address: "",
    role: "",
    hourlyRate: "",
  });

  const loadShifts = async () => {
    setLoading(true);
    setError("");

    try {
      const ref = collection(db, "shifts");
      const q = query(ref, orderBy("date", "desc"));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setShifts(data);
    } catch (err) {
      console.error("Error loading shifts:", err);
      setError("Could not load shifts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  // Helpers
  const getClientName = (shift) =>
    shift.clientOrganisation ||
    shift.clientName ||
    shift.clientEmail ||
    "Unknown client";

  const getStatusBadge = (status) => {
    const s = (status || "").toLowerCase();

    if (s === "open") {
      return {
        label: "Open",
        className:
          "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };
    }
    if (s === "client_pending" || s === "pending") {
      return {
        label: "Client pending",
        className:
          "bg-amber-50 text-amber-700 border border-amber-200",
      };
    }
    if (s === "booked") {
      return {
        label: "Booked",
        className: "bg-blue-50 text-blue-700 border border-blue-200",
      };
    }
    if (s === "cancelled") {
      return {
        label: "Cancelled",
        className: "bg-rose-50 text-rose-700 border border-rose-200",
      };
    }
    return {
      label: s || "Unknown",
      className: "bg-slate-50 text-slate-600 border border-slate-200",
    };
  };

  // ---- STATUS ACTIONS (confirm / approve / cancel etc.) ----
  const updateShiftStatus = async (shift, newStatus) => {
    if (!currentUser) return;

    const messages = {
      open: "Approve/confirm this shift and make it open to staff?",
      booked: "Mark this shift as booked?",
      cancelled: "Cancel this shift?",
    };

    const confirmMsg =
      messages[newStatus] || `Change status to "${newStatus}"?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSavingId(shift.id);
      const ref = doc(db, "shifts", shift.id);
      await updateDoc(ref, {
        status: newStatus,
        updatedByAdminId: currentUser.uid,
        updatedAt: new Date(),
      });
      await loadShifts();
    } catch (err) {
      console.error("Error updating shift:", err);
      alert("Could not update shift.");
    } finally {
      setSavingId(null);
    }
  };

  // ---- EDITING ----
  const startEdit = (shift) => {
    const dateObj = shift.date?.toDate ? shift.date.toDate() : null;
    const dateStr = dateObj ? dateObj.toISOString().slice(0, 10) : "";

    setEditForm({
      date: dateStr,
      startTime: shift.startTime || "",
      endTime: shift.endTime || "",
      location: shift.location || "",
      address: shift.address || "",
      role: shift.role || "",
      hourlyRate:
        typeof shift.hourlyRate === "number"
          ? shift.hourlyRate.toString()
          : shift.hourlyRate || "",
    });

    setEditingId(shift.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({
      date: "",
      startTime: "",
      endTime: "",
      location: "",
      address: "",
      role: "",
      hourlyRate: "",
    });
  };

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const saveEdit = async (shift) => {
    if (!currentUser) return;

    if (
      !editForm.date ||
      !editForm.startTime ||
      !editForm.endTime ||
      !editForm.location ||
      !editForm.role
    ) {
      alert("Please fill in date, time, location and role.");
      return;
    }

    const rateNumber = Number(editForm.hourlyRate);
    if (editForm.hourlyRate && Number.isNaN(rateNumber)) {
      alert("Hourly rate must be a valid number.");
      return;
    }

    try {
      setSavingId(shift.id);

      const updateData = {
        location: editForm.location,
        address: editForm.address || null,
        role: editForm.role,
        startTime: editForm.startTime,
        endTime: editForm.endTime,
        hourlyRate: editForm.hourlyRate ? rateNumber : null,
        updatedByAdminId: currentUser.uid,
        updatedAt: new Date(),
      };

      if (editForm.date) {
        const d = new Date(editForm.date);
        d.setHours(0, 0, 0, 0);
        updateData.date = Timestamp.fromDate(d);
      }

      const ref = doc(db, "shifts", shift.id);
      await updateDoc(ref, updateData);

      cancelEdit();
      await loadShifts();
    } catch (err) {
      console.error("Error saving shift changes:", err);
      alert("Could not save changes.");
    } finally {
      setSavingId(null);
    }
  };

  // ---- FILTER + SORT ----
  const filteredAndSorted = useMemo(() => {
    let list = [...shifts];

    // Filter by status
    if (statusFilter !== "all") {
      list = list.filter((s) => {
        const st = (s.status || "").toLowerCase();
        if (statusFilter === "open") return st === "open";
        if (statusFilter === "client_pending")
          return st === "client_pending" || st === "pending";
        if (statusFilter === "booked") return st === "booked";
        if (statusFilter === "cancelled") return st === "cancelled";
        return true;
      });
    }

    // Filter by client
    if (clientFilter.trim()) {
      const term = clientFilter.toLowerCase();
      list = list.filter((s) => {
        const cName = getClientName(s).toLowerCase();
        const cEmail = (s.clientEmail || "").toLowerCase();
        return cName.includes(term) || cEmail.includes(term);
      });
    }

    // Sort
    list.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortBy === "client") {
        aVal = getClientName(a).toLowerCase();
        bVal = getClientName(b).toLowerCase();
      } else if (sortBy === "status") {
        aVal = (a.status || "").toLowerCase();
        bVal = (b.status || "").toLowerCase();
      } else {
        const aDate =
          a.date?.toDate?.() || a.createdAt?.toDate?.() || null;
        const bDate =
          b.date?.toDate?.() || b.createdAt?.toDate?.() || null;
        aVal = aDate ? aDate.getTime() : 0;
        bVal = bDate ? bDate.getTime() : 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [shifts, statusFilter, clientFilter, sortBy, sortDirection]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-9 w-9 rounded-2xl bg-cyan-100 flex items-center justify-center">
              <CalendarDays className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                Admin – Shifts
              </h2>
              <p className="text-xs text-slate-500">
                Confirm client shifts, approve them for staff, edit details and
                monitor bookings.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
          <span>
            Total shifts:{" "}
            <span className="font-semibold text-slate-800">
              {shifts.length}
            </span>
          </span>
          <span>
            Open:{" "}
            <span className="font-semibold text-emerald-700">
              {
                shifts.filter(
                  (s) => (s.status || "").toLowerCase() === "open"
                ).length
              }
            </span>
          </span>
        </div>
      </div>

      {/* Filters + sort row */}
      <div className="card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Filters */}
        <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ListFilter className="h-3.5 w-3.5" />
            <span>Filter</span>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-40"
          >
            <option value="all">All status</option>
            <option value="open">Open</option>
            <option value="client_pending">Client pending</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Users className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              placeholder="Filter by client name or email…"
              className="input pl-8 text-xs"
            />
          </div>
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
            <option value="date">Date</option>
            <option value="client">Client</option>
            <option value="status">Status</option>
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
          Loading shifts…
        </div>
      ) : !filteredAndSorted.length ? (
        <div className="card text-sm text-slate-600">
          No shifts found. Adjust your filters or sort options.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Date
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Time
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Client
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  Location
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Role
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Staff (requested / booked)
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Rates (£/hr)
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Status
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((shift, idx) => {
                const isEditing = editingId === shift.id;

                const dateObj = shift.date?.toDate
                  ? shift.date.toDate()
                  : null;
                const dateDisplay = dateObj
                  ? dateObj.toLocaleDateString()
                  : "—";
                const dateInput = dateObj
                  ? dateObj.toISOString().slice(0, 10)
                  : "";

                const statusBadge = getStatusBadge(shift.status);
                const staffText =
                  shift.requestedStaffEmail ||
                  shift.bookedByEmail ||
                  "—";

                const staffRate =
                  typeof shift.hourlyRate === "number"
                    ? shift.hourlyRate
                    : null;
                // Try a few possible field names for client/billing rate
                const clientRateRaw =
                  shift.clientRate ??
                  shift.billingRate ??
                  shift.clientHourlyRate ??
                  null;

                return (
                  <tr
                    key={shift.id}
                    className={`border-b border-slate-100 ${
                      idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                    }`}
                  >
                    {/* Date */}
                    <td className="px-3 py-2 align-top text-slate-700 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.date || dateInput}
                          onChange={(e) =>
                            handleEditChange("date", e.target.value)
                          }
                          className="input !text-[11px] !py-1 !h-8"
                        />
                      ) : (
                        dateDisplay
                      )}
                    </td>

                    {/* Time */}
                    <td className="px-3 py-2 align-top text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="time"
                            value={editForm.startTime || shift.startTime || ""}
                            onChange={(e) =>
                              handleEditChange(
                                "startTime",
                                e.target.value
                              )
                            }
                            className="input !text-[11px] !py-1 !h-8"
                          />
                          <input
                            type="time"
                            value={editForm.endTime || shift.endTime || ""}
                            onChange={(e) =>
                              handleEditChange("endTime", e.target.value)
                            }
                            className="input !text-[11px] !py-1 !h-8"
                          />
                        </div>
                      ) : (
                        `${shift.startTime || "?"} – ${
                          shift.endTime || "?"
                        }`
                      )}
                    </td>

                    {/* Client */}
                    <td className="px-3 py-2 align-top">
                      <div className="text-slate-900 font-semibold">
                        {getClientName(shift)}
                      </div>
                      {shift.clientEmail && (
                        <div className="text-[11px] text-slate-500">
                          {shift.clientEmail}
                        </div>
                      )}
                    </td>

                    {/* Location */}
                    <td className="px-3 py-2 align-top text-slate-600">
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={editForm.location || shift.location || ""}
                            onChange={(e) =>
                              handleEditChange("location", e.target.value)
                            }
                            className="input !text-[11px] !py-1 !h-8"
                            placeholder="Location / Ward"
                          />
                          <input
                            type="text"
                            value={editForm.address || shift.address || ""}
                            onChange={(e) =>
                              handleEditChange("address", e.target.value)
                            }
                            className="input !text-[11px] !py-1 !h-8"
                            placeholder="Address (optional)"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="font-medium text-slate-800">
                            {shift.location || "—"}
                          </div>
                          {shift.address && (
                            <div className="text-[11px] text-slate-500">
                              {shift.address}
                            </div>
                          )}
                        </>
                      )}
                    </td>

                    {/* Role */}
                    <td className="px-3 py-2 align-top text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.role || shift.role || ""}
                          onChange={(e) =>
                            handleEditChange("role", e.target.value)
                          }
                          className="input !text-[11px] !py-1 !h-8"
                          placeholder="Role"
                        />
                      ) : (
                        shift.role || "—"
                      )}
                    </td>

                    {/* Staff */}
                    <td className="px-3 py-2 align-top text-slate-600 whitespace-nowrap">
                      {staffText}
                    </td>

                    {/* Rates */}
                    <td className="px-3 py-2 align-top text-slate-700 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="number"
                          value={
                            editForm.hourlyRate ??
                            (typeof shift.hourlyRate === "number"
                              ? shift.hourlyRate
                              : "")
                          }
                          onChange={(e) =>
                            handleEditChange(
                              "hourlyRate",
                              e.target.value
                            )
                          }
                          className="input !text-[11px] !py-1 !h-8"
                          placeholder="Staff rate"
                        />
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-slate-600">
                            Staff:{" "}
                            <span className="font-semibold text-slate-900">
                              {typeof staffRate === "number"
                                ? `£${staffRate.toFixed(2)}`
                                : "—"}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-600">
                            Client:{" "}
                            <span className="font-semibold text-slate-900">
                              {typeof clientRateRaw === "number"
                                ? `£${clientRateRaw.toFixed(2)}`
                                : clientRateRaw
                                ? `£${clientRateRaw}`
                                : "—"}
                            </span>
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {/* Approve / confirm for client_pending */}
                        {(shift.status === "client_pending" ||
                          shift.status === "pending") &&
                          !isEditing && (
                            <button
                              type="button"
                              onClick={() =>
                                updateShiftStatus(shift, "open")
                              }
                              disabled={savingId === shift.id}
                              className="btn !px-3 !py-1 !text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {savingId === shift.id
                                ? "Approving…"
                                : "Approve client shift"}
                            </button>
                          )}

                        {/* Mark open */}
                        {!isEditing &&
                          shift.status !== "open" &&
                          shift.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateShiftStatus(shift, "open")
                              }
                              disabled={savingId === shift.id}
                              className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                            >
                              Set open
                            </button>
                          )}

                        {/* Mark booked */}
                        {!isEditing &&
                          shift.status !== "booked" &&
                          shift.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateShiftStatus(shift, "booked")
                              }
                              disabled={savingId === shift.id}
                              className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                            >
                              Mark booked
                            </button>
                          )}

                        {/* Cancel shift */}
                        {!isEditing && shift.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() =>
                              updateShiftStatus(shift, "cancelled")
                            }
                            disabled={savingId === shift.id}
                            className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        )}

                        {/* Edit / Save / Cancel edit */}
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(shift)}
                              disabled={savingId === shift.id}
                              className="btn !px-3 !py-1 !text-[11px] bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-60 inline-flex items-center gap-1"
                            >
                              {savingId === shift.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingId === shift.id}
                              className="btn btn-outline !px-3 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-60"
                            >
                              <XCircle className="h-3 w-3" />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(shift)}
                            disabled={savingId === shift.id}
                            className="btn btn-outline !px-3 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-60"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        )}
                      </div>
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
