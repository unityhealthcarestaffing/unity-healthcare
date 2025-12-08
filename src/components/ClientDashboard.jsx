// src/components/ClientDashboard.jsx
import { useEffect, useState, Fragment } from "react";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  Timestamp,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// ---------- Helpers ----------

function buildClientLocationFromProfile(profile) {
  if (!profile) return {};

  const nameParts = [];
  if (profile.organisationName) nameParts.push(profile.organisationName);
  if (profile.tradingName) nameParts.push(`(${profile.tradingName})`);

  const defaultLocation = nameParts.join(" ");

  return {
    defaultLocation,
    defaultAddress: profile.organisationAddress || "",
    defaultPostcode: profile.organisationPostcode || "",
    defaultLandmark: profile.landmark || "",
  };
}

function computeHoursBetweenTimes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;

  let diffMinutes = eh * 60 + em - (sh * 60 + sm);
  if (diffMinutes <= 0) return null; // ignore overnight for now

  return diffMinutes / 60;
}

function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) return "-";
  return `£${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function makeMultiRow() {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    date: "",
    startTime: "",
    endTime: "",
    role: "",
    staffNeeded: "1",
    hourlyRate: "",
  };
}

export default function ClientDashboard({ currentUser }) {
  const [bookingMode, setBookingMode] = useState("single"); // "single" | "multi"

  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [clientProfile, setClientProfile] = useState(null);
  const [clientPrefillError, setClientPrefillError] = useState("");

  // Single-shift form
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [landmarks, setLandmarks] = useState("");
  const [role, setRole] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [staffNeededSingle, setStaffNeededSingle] = useState("1");

  // Multi-day rows
  const [multiRows, setMultiRows] = useState([makeMultiRow()]);
  const [shiftBookedBy, setShiftBookedBy] = useState("");

  // Filters + sorting
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [expandedShiftId, setExpandedShiftId] = useState(null);

  // ---------- Load client profile & prefill ----------

  useEffect(() => {
    const loadClientProfile = async () => {
      if (!currentUser) return;

      try {
        const clientRef = doc(db, "clients", currentUser.uid);
        const snap = await getDoc(clientRef);

        if (!snap.exists()) {
          setClientProfile(null);
          setClientPrefillError(
            "We couldn’t find your saved client details. You can still fill in the form manually."
          );
          return;
        }

        const data = snap.data();
        setClientProfile(data);

        const defaults = buildClientLocationFromProfile(data);

        setLocation((prev) => prev || defaults.defaultLocation || "");
        setAddress((prev) => prev || defaults.defaultAddress || "");
        setPostcode((prev) => prev || defaults.defaultPostcode || "");
        setLandmarks((prev) => prev || defaults.defaultLandmark || "");
      } catch (err) {
        console.error("Error loading client profile:", err);
        setClientPrefillError(
          "We couldn’t load your saved details. You can still fill in the form manually."
        );
      }
    };

    loadClientProfile();
  }, [currentUser]);

  // ---------- Load client shifts ----------

  const loadShifts = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError("");

    try {
      const ref = collection(db, "shifts");
      const q = query(
        ref,
        where("clientId", "==", currentUser.uid),
        orderBy("date", "desc")
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setShifts(data);
    } catch (err) {
      console.error("Error loading client shifts:", err);
      setError("Could not load your shifts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ---------- Create single shift ----------

  const handleCreateSingle = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    setError("");

    if (
      !location ||
      !role ||
      !date ||
      !startTime ||
      !endTime ||
      !hourlyRate ||
      !staffNeededSingle
    ) {
      setError("Please complete all required fields.");
      return;
    }

    const rateNumber = Number(hourlyRate);
    const staffNeededNumber = Number(staffNeededSingle);

    if (Number.isNaN(rateNumber) || rateNumber <= 0) {
      setError("Hourly rate must be a positive number.");
      return;
    }

    if (Number.isNaN(staffNeededNumber) || staffNeededNumber <= 0) {
      setError("Number of staff needed must be at least 1.");
      return;
    }

    try {
      setSaving(true);
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);

      await addDoc(collection(db, "shifts"), {
        bookingMode: "single",
        location,
        address: address || null,
        postcode: postcode || null,
        landmarks: landmarks || null,
        role,
        date: Timestamp.fromDate(d),
        startTime,
        endTime,
        hourlyRate: rateNumber,
        staffNeeded: staffNeededNumber,
        status: "client_pending", // awaiting admin approval
        bookedBy: null,
        requestedStaffId: null,
        requestedStaffEmail: null,
        clientId: currentUser.uid,
        clientEmail: currentUser.email || null,
        createdBy: currentUser.uid,
        createdAt: Timestamp.now(),
        clientName: clientProfile?.organisationName || null,
        clientOrganisation:
          clientProfile?.tradingName || clientProfile?.organisationName || null,
      });

      // Keep static client details; clear shift-specific fields
      setRole("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setHourlyRate("");
      setStaffNeededSingle("1");

      await loadShifts();
      alert("Shift created and sent for admin approval.");
    } catch (err) {
      console.error("Error creating client shift:", err);
      setError("Could not create shift.");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Multi-day helpers ----------

  const handleMultiRowChange = (rowId, field, value) => {
    setMultiRows((rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r))
    );
  };

  const handleAddMultiRow = () => {
    setMultiRows((rows) => [...rows, makeMultiRow()]);
  };

  const handleRemoveMultiRow = (rowId) => {
    setMultiRows((rows) =>
      rows.length === 1 ? rows : rows.filter((r) => r.id !== rowId)
    );
  };

  const handleCreateMulti = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    setError("");

    if (!location) {
      setError("Please complete client details (location).");
      return;
    }

    const validRows = multiRows.filter(
      (r) =>
        r.date &&
        r.startTime &&
        r.endTime &&
        r.role &&
        r.staffNeeded &&
        r.hourlyRate
    );

    if (!validRows.length) {
      setError(
        "Please add at least one complete row (date, time, role, staff and hourly rate)."
      );
      return;
    }

    try {
      setSaving(true);

      const batchPromises = validRows.map((row) => {
        const d = new Date(row.date);
        d.setHours(0, 0, 0, 0);

        const staffNeededNumber = Number(row.staffNeeded) || 1;
        const rateNumber = Number(row.hourlyRate);

        if (Number.isNaN(rateNumber) || rateNumber <= 0) {
          throw new Error("Hourly rate must be a positive number.");
        }

        return addDoc(collection(db, "shifts"), {
          bookingMode: "multi",
          location,
          address: address || null,
          postcode: postcode || null,
          landmarks: landmarks || null,
          role: row.role,
          date: Timestamp.fromDate(d),
          startTime: row.startTime,
          endTime: row.endTime,
          hourlyRate: rateNumber,
          staffNeeded: staffNeededNumber,
          status: "client_pending",
          bookedBy: null,
          requestedStaffId: null,
          requestedStaffEmail: null,
          clientId: currentUser.uid,
          clientEmail: currentUser.email || null,
          createdBy: currentUser.uid,
          createdAt: Timestamp.now(),
          clientName: clientProfile?.organisationName || null,
          clientOrganisation:
            clientProfile?.tradingName ||
            clientProfile?.organisationName ||
            null,
          shiftBookedBy: shiftBookedBy || null,
        });
      });

      await Promise.all(batchPromises);

      setMultiRows([makeMultiRow()]);

      await loadShifts();
      alert("Multi-day shifts created and sent for admin approval.");
    } catch (err) {
      console.error("Error creating multi-day shifts:", err);
      setError("Could not create multi-day shifts.");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Approve / Reject booking ----------

  const handleApprove = async (shift) => {
    if (!window.confirm("Approve this staff booking?")) return;
    try {
      const ref = doc(db, "shifts", shift.id);
      await updateDoc(ref, {
        status: "booked",
        approvedByClientId: currentUser.uid,
        approvedByClientEmail: currentUser.email || null,
        approvedAt: Timestamp.now(),
      });
      await loadShifts();
      alert("Booking approved.");
    } catch (err) {
      console.error("Error approving booking:", err);
      alert("Could not approve booking.");
    }
  };

  const handleReject = async (shift) => {
    if (!window.confirm("Reject this booking and reopen the shift?")) return;
    try {
      const ref = doc(db, "shifts", shift.id);
      await updateDoc(ref, {
        status: "open",
        bookedBy: null,
        requestedStaffId: null,
        requestedStaffEmail: null,
        approvedByClientId: null,
        approvedByClientEmail: null,
        approvedAt: null,
      });
      await loadShifts();
      alert("Booking rejected. Shift is open again.");
    } catch (err) {
      console.error("Error rejecting booking:", err);
      alert("Could not reject booking.");
    }
  };

  // ---------- Filter + sort ----------

  const filteredShifts = shifts.filter((shift) => {
    if (statusFilter !== "all" && shift.status !== statusFilter) return false;

    if (dateFilter) {
      const filterDate = new Date(dateFilter);
      filterDate.setHours(0, 0, 0, 0);
      const shiftDate = shift.date?.toDate ? shift.date.toDate() : null;
      if (!shiftDate) return false;
      shiftDate.setHours(0, 0, 0, 0);

      const same =
        shiftDate.getFullYear() === filterDate.getFullYear() &&
        shiftDate.getMonth() === filterDate.getMonth() &&
        shiftDate.getDate() === filterDate.getDate();

      if (!same) return false;
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const haystack = `${shift.location || ""} ${shift.role || ""}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    return true;
  });

  const displayedShifts = [...filteredShifts].sort((a, b) => {
    const dateA = a.date?.toDate ? a.date.toDate() : null;
    const dateB = b.date?.toDate ? b.date.toDate() : null;

    const roleA = (a.role || "").toLowerCase();
    const roleB = (b.role || "").toLowerCase();

    const staffA = (
      a.requestedStaffEmail ||
      a.bookedByEmail ||
      a.bookedStaffEmail ||
      ""
    ).toLowerCase();
    const staffB = (
      b.requestedStaffEmail ||
      b.bookedByEmail ||
      b.bookedStaffEmail ||
      ""
    ).toLowerCase();

    switch (sortBy) {
      case "date_asc":
        if (!dateA || !dateB) return 0;
        return dateA - dateB;
      case "role":
        return roleA.localeCompare(roleB);
      case "staff":
        return staffA.localeCompare(staffB);
      case "date_desc":
      default:
        if (!dateA || !dateB) return 0;
        return dateB - dateA;
    }
  });

  // ---------- Render ----------

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Client – Shifts &amp; Bookings
        </h2>
        <p className="text-xs text-slate-500">
          Post single or multi-day shifts for Unity staff. Shifts you create will
          be{" "}
          <span className="font-semibold text-amber-700">
            pending admin approval
          </span>{" "}
          before staff can see them.
        </p>
      </div>

      {/* CREATE SHIFTS CARD */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Create Shifts
            </h3>
            <p className="text-[11px] text-slate-500">
              Use single or multi-day patterns to post shifts quickly.
            </p>
          </div>

          <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setBookingMode("single")}
              className={`px-3 py-1.5 rounded-full font-medium transition ${
                bookingMode === "single"
                  ? "bg-cyan-700 text-white shadow"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Single Shift
            </button>
            <button
              type="button"
              onClick={() => setBookingMode("multi")}
              className={`px-3 py-1.5 rounded-full font-medium transition ${
                bookingMode === "multi"
                  ? "bg-cyan-700 text-white shadow"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Multi-Day
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {clientPrefillError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {clientPrefillError}
          </div>
        )}

        {/* SINGLE SHIFT FORM */}
        {bookingMode === "single" && (
          <form
            onSubmit={handleCreateSingle}
            className="space-y-4 border-t border-slate-100 pt-4"
          >
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Location / Ward (required)
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="input"
                    placeholder="e.g. Ysbyty Gwynedd – Ward B"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date (required)
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Start time (required)
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Address (optional)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="input"
                    placeholder="e.g. Penrhosgarnedd, Bangor"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    End time (required)
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Hourly rate (£, required)
                  </label>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="input"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Postcode (optional)
                  </label>
                  <input
                    type="text"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    className="input"
                    placeholder="LL57 2PW"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Role (required)
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="input bg-white"
                  >
                    <option value="">Select role</option>
                    <option value="Nurse">Nurse</option>
                    <option value="HCA">Healthcare Assistant (HCA)</option>
                    <option value="Support Worker">Support Worker</option>
                    <option value="RGN">Registered General Nurse (RGN)</option>
                    <option value="RMN">
                      Registered Mental Health Nurse (RMN)
                    </option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Number of staff needed (required)
                  </label>
                  <input
                    type="number"
                    value={staffNeededSingle}
                    onChange={(e) => setStaffNeededSingle(e.target.value)}
                    className="input"
                    min="1"
                    step="1"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nearby landmarks / notes (optional)
                </label>
                <input
                  type="text"
                  value={landmarks}
                  onChange={(e) => setLandmarks(e.target.value)}
                  className="input"
                  placeholder="e.g. Opposite A&E, near staff car park"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-full bg-cyan-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-cyan-800 disabled:opacity-60"
            >
              {saving ? "Posting…" : "Create shift"}
            </button>
          </form>
        )}

        {/* MULTI-DAY FORM */}
        {bookingMode === "multi" && (
          <form
            onSubmit={handleCreateMulti}
            className="space-y-4 border-t border-slate-100 pt-4"
          >
            <p className="text-[11px] text-slate-500">
              Use this to create several dates with the same client details.
              Each row can have its own role, staff numbers and hourly rate.
            </p>

            {/* Prefilled client details (top) */}
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Location / Ward (required)
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Postcode (optional)
                  </label>
                  <input
                    type="text"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Address (optional)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Shift booked by (optional)
                  </label>
                  <input
                    type="text"
                    value={shiftBookedBy}
                    onChange={(e) => setShiftBookedBy(e.target.value)}
                    className="input"
                    placeholder="e.g. Unity Healthcare Staffing"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nearby landmarks / notes (optional)
                </label>
                <input
                  type="text"
                  value={landmarks}
                  onChange={(e) => setLandmarks(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            {/* Multi-day rows – full width */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 mt-2">
              <div className="border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">
                  Multi-day pattern
                </span>
                <span className="text-[11px] text-slate-500">
                  Add a row for each date and time.
                </span>
              </div>

              <div className="divide-y divide-slate-200">
                {multiRows.map((row, idx) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 md:grid-cols-6 gap-2 px-3 py-2"
                  >
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) =>
                          handleMultiRowChange(row.id, "date", e.target.value)
                        }
                        className="input !py-1.5 !text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        Start
                      </label>
                      <input
                        type="time"
                        value={row.startTime}
                        onChange={(e) =>
                          handleMultiRowChange(row.id, "startTime", e.target.value)
                        }
                        className="input !py-1.5 !text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        End
                      </label>
                      <input
                        type="time"
                        value={row.endTime}
                        onChange={(e) =>
                          handleMultiRowChange(row.id, "endTime", e.target.value)
                        }
                        className="input !py-1.5 !text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        Role (required)
                      </label>
                      <select
                        value={row.role}
                        onChange={(e) =>
                          handleMultiRowChange(row.id, "role", e.target.value)
                        }
                        className="input !py-1.5 !text-[11px] bg-white"
                      >
                        <option value="">Select role</option>
                        <option value="Nurse">Nurse</option>
                        <option value="HCA">Healthcare Assistant (HCA)</option>
                        <option value="Support Worker">Support Worker</option>
                        <option value="RGN">Registered General Nurse (RGN)</option>
                        <option value="RMN">
                          Registered Mental Health Nurse (RMN)
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        Staff needed
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={row.staffNeeded}
                          onChange={(e) =>
                            handleMultiRowChange(
                              row.id,
                              "staffNeeded",
                              e.target.value
                            )
                          }
                          className="input !py-1.5 !text-[11px]"
                          min="1"
                          step="1"
                        />
                        {multiRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMultiRow(row.id)}
                            className="text-[10px] text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                        {multiRows.length === 1 && idx === 0 && (
                          <span className="text-[10px] text-slate-400">
                            Min 1
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-1">
                        Hourly rate (£)
                      </label>
                      <input
                        type="number"
                        value={row.hourlyRate}
                        onChange={(e) =>
                          handleMultiRowChange(
                            row.id,
                            "hourlyRate",
                            e.target.value
                          )
                        }
                        className="input !py-1.5 !text-[11px]"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-3 py-2 border-t border-slate-200 flex justify-between items-center">
                <button
                  type="button"
                  onClick={handleAddMultiRow}
                  className="text-[11px] font-medium text-cyan-700 hover:text-cyan-800"
                >
                  + Add another day
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-full bg-cyan-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-cyan-800 disabled:opacity-60"
            >
              {saving ? "Posting…" : "Create multi-day shifts"}
            </button>
          </form>
        )}
      </div>

      {/* SHIFTS YOU HAVE POSTED */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Shifts you have posted
          </h3>

          {shifts.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input !h-7 !py-0 !px-2 !text-[11px] !rounded-full bg-white"
                >
                  <option value="all">All</option>
                  <option value="client_pending">Awaiting admin</option>
                  <option value="open">Open</option>
                  <option value="pending">Client decision</option>
                  <option value="booked">Booked</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-500">Date:</span>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="input !h-7 !py-0 !px-2 !text-[11px] !rounded-full"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-500">Search:</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Location or role"
                  className="input !h-7 !py-0 !px-2 !text-[11px] !rounded-full"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-500">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="input !h-7 !py-0 !px-2 !text-[11px] !rounded-full bg-white"
                >
                  <option value="date_desc">Date – newest first</option>
                  <option value="date_asc">Date – oldest first</option>
                  <option value="role">Role</option>
                  <option value="staff">Staff booking</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-slate-600">Loading shifts…</div>
        ) : !displayedShifts.length ? (
          <div className="card text-sm text-slate-600">
            {shifts.length
              ? "No shifts match your filters."
              : "You have not posted any shifts yet."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] font-semibold text-slate-600">
                  <th className="px-3 py-2">Location / Ward</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Staff needed</th>
                  <th className="px-3 py-2">Rate (£/hr)</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Staff booking</th>
                  <th className="px-3 py-2">Est. bill</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedShifts.map((shift) => {
                  const dateObj = shift.date?.toDate
                    ? shift.date.toDate()
                    : null;
                  const dateStr = dateObj
                    ? dateObj.toLocaleDateString("en-GB")
                    : "-";

                  const hours = computeHoursBetweenTimes(
                    shift.startTime,
                    shift.endTime
                  );
                  const hourly =
                    typeof shift.hourlyRate === "number"
                      ? shift.hourlyRate
                      : Number(shift.hourlyRate) || 0;
                  const staffNeeded = shift.staffNeeded || 1;
                  const estBill =
                    hours != null ? hours * hourly * staffNeeded : null;

                  let badgeClass =
                    "bg-slate-50 text-slate-700 border border-slate-200";
                  let badgeText = shift.status || "open";

                  if (shift.status === "open") {
                    badgeClass =
                      "bg-emerald-50 text-emerald-700 border border-emerald-200";
                    badgeText = "Open";
                  } else if (shift.status === "pending") {
                    badgeClass =
                      "bg-amber-50 text-amber-700 border border-amber-200";
                    badgeText = "Pending client";
                  } else if (shift.status === "booked") {
                    badgeClass =
                      "bg-blue-50 text-blue-700 border border-blue-200";
                    badgeText = "Booked";
                  } else if (shift.status === "client_pending") {
                    badgeClass =
                      "bg-amber-50 text-amber-800 border border-amber-200";
                    badgeText = "Awaiting admin approval";
                  }

                  const staffEmail =
                    shift.requestedStaffEmail ||
                    shift.bookedByEmail ||
                    shift.bookedStaffEmail ||
                    "";

                  const isExpanded = expandedShiftId === shift.id;

                  return (
                    <Fragment key={shift.id}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {shift.location}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{dateStr}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {shift.startTime} – {shift.endTime}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {shift.role || "-"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {staffNeeded}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {hourly ? formatMoney(hourly) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`badge ${badgeClass} text-[10px] font-semibold`}
                          >
                            {badgeText}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {staffEmail || "-"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {estBill != null && hours != null
                            ? `${formatMoney(estBill)} (${hours.toFixed(1)}h)`
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedShiftId(
                                isExpanded ? null : shift.id
                              )
                            }
                            className="text-[11px] font-medium text-cyan-700 hover:text-cyan-800"
                          >
                            {isExpanded ? "Hide details" : "View details"}
                          </button>

                          {shift.status === "pending" &&
                            shift.requestedStaffId && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApprove(shift)}
                                  className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReject(shift)}
                                  className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td
                            className="px-3 py-2 text-[11px] text-slate-600"
                            colSpan={10}
                          >
                            <div className="flex flex-wrap gap-4">
                              {shift.address && (
                                <div>
                                  <span className="font-semibold">
                                    Address:
                                  </span>{" "}
                                  {shift.address}
                                </div>
                              )}
                              {shift.postcode && (
                                <div>
                                  <span className="font-semibold">
                                    Postcode:
                                  </span>{" "}
                                  {shift.postcode}
                                </div>
                              )}
                              {shift.landmarks && (
                                <div>
                                  <span className="font-semibold">
                                    Landmarks / notes:
                                  </span>{" "}
                                  {shift.landmarks}
                                </div>
                              )}
                              {shift.clientOrganisation && (
                                <div>
                                  <span className="font-semibold">Client:</span>{" "}
                                  {shift.clientOrganisation}
                                </div>
                              )}
                              {shift.shiftBookedBy && (
                                <div>
                                  <span className="font-semibold">
                                    Shift booked by:
                                  </span>{" "}
                                  {shift.shiftBookedBy}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
