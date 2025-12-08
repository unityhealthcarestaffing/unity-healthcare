// src/components/ClientShifts.jsx
import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  doc,
  updateDoc,
  runTransaction,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import useUserProfile from "../hooks/useUserProfile";

// --- Helpers ---

// Hours between start/end (handles overnight)
function calculateHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
    return 0;
  }

  const start = new Date();
  start.setHours(sh, sm, 0, 0);
  const end = new Date();
  end.setHours(eh, em, 0, 0);

  let diffMs = end - start;
  if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000; // cross midnight
  const hours = diffMs / (1000 * 60 * 60);
  return Math.round(hours * 4) / 4;
}

// Build JS date from Firestore date + time
function buildDateFromShift(shift, timeStr) {
  const base =
    shift.date?.toDate && typeof shift.date.toDate === "function"
      ? shift.date.toDate()
      : new Date();
  const [hStr, mStr] = (timeStr || "00:00").split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const d = new Date(base);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setHours(h, m, 0, 0);
  return d;
}

// Badge styling
function statusBadgeClasses(status) {
  switch (status) {
    case "client_pending":
      return "bg-amber-50 text-amber-800 border border-amber-200";
    case "open":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "pending":
      return "bg-sky-50 text-sky-800 border border-sky-200";
    case "booked":
      return "bg-indigo-50 text-indigo-800 border border-indigo-200";
    case "completed":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "cancelled_by_client":
      return "bg-rose-50 text-rose-800 border border-rose-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

// Per-client sequential reference
async function getNextClientShiftRef(dbInstance, clientUid) {
  const counterRef = doc(dbInstance, "clientCounters", clientUid);
  const nextNumber = await runTransaction(dbInstance, async (transaction) => {
    const snap = await transaction.get(counterRef);
    if (!snap.exists()) {
      transaction.set(counterRef, { nextRef: 2 });
      return 1;
    }
    const current = snap.data().nextRef || 1;
    transaction.update(counterRef, { nextRef: current + 1 });
    return current;
  });
  return nextNumber;
}

export default function ClientShifts({ currentUser }) {
  const { profile } = useUserProfile(currentUser?.uid);

  // Single vs multiple booking
  const [bookingMode, setBookingMode] = useState("single"); // "single" | "multi"

  // Single booking form
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [landmarks, setLandmarks] = useState("");
  const [role, setRole] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [staffNeeded, setStaffNeeded] = useState("1");

  // Multi booking rows
  const [multiRows, setMultiRows] = useState([
    { date: "", startTime: "", endTime: "", role: "", staffNeeded: "1", comment: "" },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Client shifts & billing
  const [myShifts, setMyShifts] = useState([]);
  const [loadingMyShifts, setLoadingMyShifts] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Sorting & filtering for My Shifts
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterStaff, setFilterStaff] = useState("all");

  // Prefill from client profile
  useEffect(() => {
    if (!profile) return;

    if (!location && profile.organisationName) {
      setLocation(profile.organisationName);
    }
    if (!address && profile.organisationAddress) {
      setAddress(profile.organisationAddress);
    }
    if (!postcode && profile.organisationPostcode) {
      setPostcode(profile.organisationPostcode);
    }
    if (!landmarks && (profile.landmark || profile.organisationLandmark)) {
      setLandmarks(profile.landmark || profile.organisationLandmark);
    }
  }, [profile]);

  // Load shifts created by this client
  const loadMyShifts = async () => {
    if (!currentUser) return;
    setLoadingMyShifts(true);
    setLoadError("");

    try {
      const shiftsRef = collection(db, "shifts");
      const q = query(
        shiftsRef,
        where("createdBy", "==", currentUser.uid),
        orderBy("date", "desc")
      );
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Auto update booked -> completed if end time passed
      const now = new Date();
      const updates = [];
      for (const s of items) {
        if (s.status === "booked") {
          const end = buildDateFromShift(s, s.endTime);
          if (end <= now) {
            const ref = doc(db, "shifts", s.id);
            updates.push(updateDoc(ref, { status: "completed" }));
            s.status = "completed";
          }
        }
      }
      if (updates.length) {
        await Promise.all(updates);
      }

      setMyShifts(items);
    } catch (err) {
      console.error("Error loading client shifts:", err);
      setLoadError("Could not load your shifts.");
    } finally {
      setLoadingMyShifts(false);
    }
  };

  useEffect(() => {
    loadMyShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // Shared client details we store on every shift
  const clientDetails = {
    clientOrgName: profile?.organisationName || null,
    clientOrgAddress: profile?.organisationAddress || null,
    clientOrgPostcode: profile?.organisationPostcode || null,
    clientOrgLandmark: profile?.landmark || profile?.organisationLandmark || null,
  };

  // ---------- Single booking submit ----------
  const handleSubmitSingle = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!location || !date || !startTime || !endTime || !role || !staffNeeded) {
      setError("Please complete all required fields.");
      return;
    }

    const staffCount = Number(staffNeeded);
    if (
      Number.isNaN(staffCount) ||
      staffCount < 1 ||
      !Number.isInteger(staffCount)
    ) {
      setError("Number of staff needed must be a whole number (1 or more).");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const d = new Date(date);
      d.setHours(0, 0, 0, 0);

      const refNumber = await getNextClientShiftRef(db, currentUser.uid);
      const refString = `C-${String(refNumber).padStart(4, "0")}`;

      const shiftsRef = collection(db, "shifts");
      const baseData = {
        location,
        address: address || null,
        postcode: postcode || null,
        landmarks: landmarks || null,
        ...clientDetails,
        date: Timestamp.fromDate(d),
        startTime,
        endTime,
        role,
        status: "client_pending",
        staffNeeded: staffCount,
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email || null,
        createdAt: Timestamp.now(),
        clientGroupId: refString,
        clientShiftRefNumber: refNumber,
        clientShiftRef: refString,
        clientComment: null,
        clientRate: null,
        staffRate: null,
      };

      const writes = [];
      for (let i = 0; i < staffCount; i += 1) {
        writes.push(addDoc(shiftsRef, baseData));
      }
      await Promise.all(writes);

      // Reset but keep org details for convenience
      setLocation(profile?.organisationName || "");
      setAddress(profile?.organisationAddress || "");
      setPostcode(profile?.organisationPostcode || "");
      setLandmarks(profile?.landmark || profile?.organisationLandmark || "");
      setRole("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setStaffNeeded("1");

      await loadMyShifts();
      alert(
        `Shift request submitted (Ref: ${refString}). ${staffCount} slot${
          staffCount > 1 ? "s" : ""
        } created.`
      );
    } catch (err) {
      console.error("Error submitting shift:", err);
      setError("Could not submit shift. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // ---------- Multi booking helpers ----------
  const updateMultiRow = (index, field, value) => {
    setMultiRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  };

  const removeMultiRow = (index) => {
    setMultiRows((rows) => rows.filter((_, i) => i !== index));
  };

  const handleSubmitMulti = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const validRows = multiRows.filter(
      (r) => r.date && r.startTime && r.endTime && (r.role || role)
    );
    if (!validRows.length) {
      setError(
        "Please complete at least one row with date, times and role for multiple booking."
      );
      return;
    }

    try {
      setSaving(true);
      setError("");

      const shiftsRef = collection(db, "shifts");

      for (const row of validRows) {
        const rowStaffCount = Number(row.staffNeeded || "1");
        if (
          Number.isNaN(rowStaffCount) ||
          rowStaffCount < 1 ||
          !Number.isInteger(rowStaffCount)
        ) {
          continue;
        }

        const d = new Date(row.date);
        d.setHours(0, 0, 0, 0);

        const refNumber = await getNextClientShiftRef(db, currentUser.uid);
        const refString = `C-${String(refNumber).padStart(4, "0")}`;

        const baseData = {
          location,
          address: address || null,
          postcode: postcode || null,
          landmarks: landmarks || null,
          ...clientDetails,
          date: Timestamp.fromDate(d),
          startTime: row.startTime,
          endTime: row.endTime,
          role: row.role || role || "",
          status: "client_pending",
          staffNeeded: rowStaffCount,
          createdBy: currentUser.uid,
          createdByEmail: currentUser.email || null,
          createdAt: Timestamp.now(),
          clientGroupId: refString,
          clientShiftRefNumber: refNumber,
          clientShiftRef: refString,
          clientComment: row.comment || null,
          clientRate: null,
          staffRate: null,
        };

        const writes = [];
        for (let i = 0; i < rowStaffCount; i += 1) {
          writes.push(addDoc(shiftsRef, baseData));
        }
        await Promise.all(writes);
      }

      setMultiRows([
        { date: "", startTime: "", endTime: "", role: "", staffNeeded: "1", comment: "" },
      ]);

      await loadMyShifts();
      alert("Multiple shift requests submitted to Unity for approval.");
    } catch (err) {
      console.error("Error submitting multiple shifts:", err);
      setError("Could not submit multiple shifts. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelShift = async (shift) => {
    if (!currentUser) return;

    const ok = window.confirm(
      "Cancel this shift? You may not be able to cancel within 48 hours of the start time."
    );
    if (!ok) return;

    try {
      const ref = doc(db, "shifts", shift.id);
      await updateDoc(ref, {
        status: "cancelled_by_client",
      });
      await loadMyShifts();
      alert("Shift cancelled.");
    } catch (err) {
      console.error("Error cancelling shift:", err);
      alert(
        "Could not cancel this shift. It may be within 48 hours of the start time or you may not have permission."
      );
    }
  };

  // ---------- Billing + sort/filter ----------
  const staffLabel = (s) =>
    (s.bookedStaffName ||
      s.bookedStaffEmail ||
      s.bookedBy ||
      "")?.toString();

  const roleOptions = Array.from(
    new Set(myShifts.map((s) => s.role).filter(Boolean))
  ).sort();
  const statusOptions = Array.from(
    new Set(myShifts.map((s) => s.status).filter(Boolean))
  ).sort();
  const staffOptions = Array.from(
    new Set(
      myShifts
        .map((s) => staffLabel(s))
        .filter((v) => v && v.trim().length > 0)
    )
  ).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const sortedShifts = [...myShifts].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;

    switch (sortField) {
      case "status": {
        const av = (a.status || "").toString().toLowerCase();
        const bv = (b.status || "").toString().toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      case "role": {
        const av = (a.role || "").toString().toLowerCase();
        const bv = (b.role || "").toString().toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      case "staff": {
        const av = staffLabel(a).toLowerCase();
        const bv = staffLabel(b).toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      case "date":
      default: {
        const da = buildDateFromShift(a, a.startTime);
        const db_ = buildDateFromShift(b, b.startTime);
        return (da - db_) * dir;
      }
    }
  });

  const filteredShifts = sortedShifts.filter((s) => {
    if (filterRole !== "all" && (s.role || "") !== filterRole) return false;
    if (filterStatus !== "all" && (s.status || "") !== filterStatus)
      return false;
    const sLabel = staffLabel(s);
    if (filterStaff !== "all" && sLabel !== filterStaff) return false;
    return true;
  });

  let totalHours = 0;
  let totalAmount = 0;
  const rowsWithBilling = filteredShifts.map((s) => {
    const hours = calculateHours(s.startTime, s.endTime);
    const rate =
      typeof s.clientRate === "number" && !Number.isNaN(s.clientRate)
        ? s.clientRate
        : typeof s.hourlyRate === "number"
        ? s.hourlyRate
        : 0;

    const amount = Math.round(hours * rate * 100) / 100;
    totalHours += hours;
    totalAmount += amount;
    return { ...s, hours, amount, billingRate: rate };
  });

  totalHours = Math.round(totalHours * 100) / 100;
  totalAmount = Math.round(totalAmount * 100) / 100;

  const clientName =
    profile?.organisationName || profile?.displayName || "Client";

  // ---------- Render ----------
  return (
    <div className="space-y-5">
      {/* CLIENT SUMMARY */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 flex flex-col gap-1 text-xs md:text-sm">
        <p className="font-semibold text-slate-900">{clientName}</p>
        {profile?.organisationAddress && (
          <p className="text-slate-600">{profile.organisationAddress}</p>
        )}
        {profile?.organisationPostcode && (
          <p className="text-slate-600">{profile.organisationPostcode}</p>
        )}
        <p className="text-slate-500">
          Account email:{" "}
          <span className="font-medium">{currentUser.email}</span>
        </p>
      </div>

      {/* UPLOAD FORM */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-slate-900">
              Upload Shifts
            </h2>
            <p className="text-xs md:text-sm text-slate-600">
              Create shifts for your organisation. Unity admin will review and
              set rates before publishing to staff.
            </p>
          </div>
        </div>

        {/* Booking mode toggle */}
        <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px] md:text-xs">
          <button
            type="button"
            onClick={() => setBookingMode("single")}
            className={`px-3 py-1.5 rounded-full ${
              bookingMode === "single"
                ? "bg-cyan-700 text-white"
                : "text-slate-700"
            }`}
          >
            Single shift
          </button>
          <button
            type="button"
            onClick={() => setBookingMode("multi")}
            className={`px-3 py-1.5 rounded-full ${
              bookingMode === "multi"
                ? "bg-cyan-700 text-white"
                : "text-slate-700"
            }`}
          >
            Multiple shifts (table)
          </button>
        </div>

        {error && (
          <div className="text-sm bg-red-50 text-red-700 px-3 py-2 rounded-md border border-red-200">
            {error}
          </div>
        )}

        {/* SINGLE SHIFT FORM */}
        {bookingMode === "single" && (
          <form
            onSubmit={handleSubmitSingle}
            className="space-y-3 text-sm md:text-base"
          >
            <div>
              <label className="text-xs md:text-sm font-semibold block mb-1">
                Location / Ward *
              </label>
              <input
                className="uh-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Ysbyty Gwynedd – Ward A"
              />
            </div>

            <div>
              <label className="text-xs md:text-sm font-semibold block mb-1">
                Address
              </label>
              <input
                className="uh-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Penrhosgarnedd, Bangor"
              />
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Postcode
                </label>
                <input
                  className="uh-input"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="e.g. LL57 2PW"
                />
              </div>

              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Nearby landmarks / notes
                </label>
                <input
                  className="uh-input"
                  value={landmarks}
                  onChange={(e) => setLandmarks(e.target.value)}
                  placeholder="e.g. Opposite A&E, near staff car park"
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="uh-input"
                >
                  <option value="">Select role</option>
                  <option value="Nurse">Nurse</option>
                  <option value="HCA">Healthcare Assistant (HCA)</option>
                  <option value="Support Worker">Support Worker</option>
                  <option value="RGN">RGN</option>
                  <option value="RMN">RMN</option>
                </select>
              </div>

              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Number of staff needed *
                </label>
                <input
                  className="uh-input"
                  type="number"
                  min="1"
                  value={staffNeeded}
                  onChange={(e) => setStaffNeeded(e.target.value)}
                  placeholder="e.g. 3"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  We’ll create this many shift slots sharing one reference.
                </p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Date *
                </label>
                <input
                  className="uh-input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  Start time *
                </label>
                <input
                  className="uh-input"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs md:text-sm font-semibold block mb-1">
                  End time *
                </label>
                <input
                  className="uh-input"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <button
              disabled={saving}
              className="w-full bg-cyan-700 text-white py-2 rounded-lg text-sm md:text-base font-semibold hover:bg-cyan-800 disabled:opacity-60"
            >
              {saving ? "Submitting shift..." : "Submit shift for approval"}
            </button>
          </form>
        )}

        {/* MULTI SHIFT FORM */}
        {bookingMode === "multi" && (
          <form
            onSubmit={handleSubmitMulti}
            className="space-y-3 text-sm md:text-base"
          >
            <p className="text-xs md:text-sm text-slate-600">
              Use the table below to request several shifts for the same
              location and client details. Each row will create one group of
              shift slots and can have its own comment/notes.
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-[11px] md:text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Start</th>
                    <th className="px-2 py-1 text-left">End</th>
                    <th className="px-2 py-1 text-left">Role</th>
                    <th className="px-2 py-1 text-left">Staff needed</th>
                    <th className="px-2 py-1 text-left">Comment / notes</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {multiRows.map((row, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1">
                        <input
                          type="date"
                          className="uh-input"
                          value={row.date}
                          onChange={(e) =>
                            updateMultiRow(idx, "date", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          className="uh-input"
                          value={row.startTime}
                          onChange={(e) =>
                            updateMultiRow(idx, "startTime", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          className="uh-input"
                          value={row.endTime}
                          onChange={(e) =>
                            updateMultiRow(idx, "endTime", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="uh-input"
                          value={row.role}
                          onChange={(e) =>
                            updateMultiRow(idx, "role", e.target.value)
                          }
                          placeholder={role || "Role"}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min="1"
                          className="uh-input"
                          value={row.staffNeeded}
                          onChange={(e) =>
                            updateMultiRow(idx, "staffNeeded", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="uh-input"
                          value={row.comment}
                          onChange={(e) =>
                            updateMultiRow(idx, "comment", e.target.value)
                          }
                          placeholder="Optional notes for this shift"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        {multiRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeMultiRow(idx)}
                            className="text-rose-600 text-[11px]"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() =>
                setMultiRows((rows) => [
                  ...rows,
                  {
                    date: "",
                    startTime: "",
                    endTime: "",
                    role: "",
                    staffNeeded: "1",
                    comment: "",
                  },
                ])
              }
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-slate-50 text-[11px] md:text-xs"
            >
              + Add row
            </button>

            <button
              disabled={saving}
              className="w-full bg-cyan-700 text-white py-2 rounded-lg text-sm md:text-base font-semibold hover:bg-cyan-800 disabled:opacity-60"
            >
              {saving ? "Submitting shifts..." : "Submit all shifts for approval"}
            </button>
          </form>
        )}
      </div>

      {/* MY SHIFTS & BILLING */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-slate-900">
              My Shifts & Billing
            </h2>
            <p className="text-xs md:text-sm text-slate-600">
              Shifts you have requested, with current billing estimates.
            </p>
          </div>

        <div className="text-right text-xs md:text-sm">
            <p className="font-semibold text-slate-800">
              Total estimated bill: £{totalAmount.toFixed(2)}
            </p>
            <p className="text-slate-500">
              {rowsWithBilling.length} shift
              {rowsWithBilling.length !== 1 && "s"} ·{" "}
              {totalHours.toFixed(2)} hours
            </p>
          </div>
        </div>

        {/* Sort & filter controls */}
        <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] md:text-xs">
          <label className="flex items-center gap-1">
            <span className="text-slate-600">Sort by</span>
            <select
              className="border border-slate-300 rounded-md px-2 py-1"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
            >
              <option value="date">Date</option>
              <option value="status">Status</option>
              <option value="role">Role</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              setSortDir((d) => (d === "asc" ? "desc" : "asc"))
            }
            className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50"
          >
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>

          {/* Filters */}
          <label className="flex items-center gap-1">
            <span className="text-slate-600">Role</span>
            <select
              className="border border-slate-300 rounded-md px-2 py-1"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
            >
              <option value="all">All</option>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1">
            <span className="text-slate-600">Status</span>
            <select
              className="border border-slate-300 rounded-md px-2 py-1"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1">
            <span className="text-slate-600">Staff</span>
            <select
              className="border border-slate-300 rounded-md px-2 py-1 max-w-[140px]"
              value={filterStaff}
              onChange={(e) => setFilterStaff(e.target.value)}
            >
              <option value="all">All</option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadingMyShifts ? (
          <p className="text-sm text-slate-600">Loading your shifts…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !rowsWithBilling.length ? (
          <p className="text-sm text-slate-600">
            You haven’t submitted any shifts yet.
          </p>
        ) : (
          <div className="space-y-2">
            {rowsWithBilling.map((shift) => {
              const dateLabel = shift.date?.toDate
                ? shift.date.toDate().toLocaleDateString()
                : "";
              const canCancel =
                shift.status === "client_pending" || shift.status === "open";

              const bookedByLabel =
                shift.bookedStaffName ||
                shift.bookedStaffEmail ||
                shift.bookedBy ||
                null;

              return (
                <div
                  key={shift.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs md:text-sm flex flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-slate-900">
                        {shift.location}
                      </p>
                      <p className="text-[11px] md:text-xs text-slate-600">
                        {dateLabel} · {shift.startTime} – {shift.endTime}
                      </p>
                      <p className="text-[11px] md:text-xs text-slate-600">
                        Role:{" "}
                        <span className="font-semibold">
                          {shift.role}
                        </span>
                      </p>
                      {shift.clientShiftRef && (
                        <p className="text-[11px] md:text-xs text-slate-500">
                          Ref: {shift.clientShiftRef}
                        </p>
                      )}
                      {shift.clientComment && (
                        <p className="text-[11px] md:text-xs text-slate-500">
                          Client notes: {shift.clientComment}
                        </p>
                      )}
                      {bookedByLabel && (
                        <p className="text-[11px] md:text-xs text-slate-500">
                          Booked by:{" "}
                          <span className="font-semibold">
                            {bookedByLabel}
                          </span>
                        </p>
                      )}
                    </div>
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                        statusBadgeClasses(shift.status)
                      }
                    >
                      {shift.status || "—"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] md:text-xs text-slate-600">
                      <span>
                        Hours:{" "}
                        <span className="font-semibold">
                          {shift.hours.toFixed(2)}
                        </span>
                      </span>
                      {" · "}
                      <span>
                        Client rate:{" "}
                        <span className="font-semibold">
                          {shift.billingRate
                            ? `£${shift.billingRate.toFixed(2)}/hr`
                            : "TBC"}
                        </span>
                      </span>
                      {" · "}
                      <span>
                        Amount:{" "}
                        <span className="font-semibold">
                          £{shift.amount.toFixed(2)}
                        </span>
                      </span>
                    </div>

                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => handleCancelShift(shift)}
                        className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      >
                        Cancel shift
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* local input styles */}
      <style>{`
        .uh-input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          outline: none;
          font-size: 0.9rem;
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
