// src/components/Timesheets.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// Build a JS Date from a shift's Firestore date + "HH:MM"
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

// Calculate hours between start/end minus breakMinutes
function calculateWorkedHours(startDate, endDate, breakMinutes) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;

  let diffMs = endDate - startDate;
  if (diffMs < 0) {
    // Crossed midnight – add 24h
    diffMs += 24 * 60 * 60 * 1000;
  }

  const totalMinutes = diffMs / (1000 * 60);
  const breakMins = Math.max(0, Number(breakMinutes) || 0);
  const worked = Math.max(0, totalMinutes - breakMins);
  const hours = worked / 60;

  // round to nearest 0.25 hour
  return Math.round(hours * 4) / 4;
}

// Timesheet status badge styling
function statusBadgeClasses(status) {
  switch (status) {
    case "submitted":
      return "bg-sky-50 text-sky-800 border border-sky-200";
    case "approved":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "rejected":
      return "bg-rose-50 text-rose-800 border border-rose-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

export default function Timesheets({ currentUser }) {
  const [shifts, setShifts] = useState([]);
  const [timesheetsByShiftId, setTimesheetsByShiftId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // active shift we’re filling a timesheet for
  const [activeShiftId, setActiveShiftId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Timesheet form state
  const [form, setForm] = useState({
    breakMinutes: "0",
    clientName: "",
    clientRole: "",
    clientSignedDate: "",
    staffDeclaration: false,
    staffSignedName: "",
    paperFileName: "",
  });

  // Load booked shifts for this staff
  const loadData = async () => {
    if (!currentUser) return;

    setLoading(true);
    setError("");

    try {
      // 1) Load shifts this staff has booked
      const shiftsRef = collection(db, "shifts");
      const qShifts = query(shiftsRef, where("bookedBy", "==", currentUser.uid));
      const snapshot = await getDocs(qShifts);

      const allShifts = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Only keep shifts that are booked & whose start time has already passed
      const now = new Date();
      const eligible = allShifts.filter((shift) => {
        if (shift.status !== "booked" && shift.status !== "completed") {
          return false;
        }
        const start = buildDateFromShift(shift, shift.startTime);
        return start <= now;
      });

      // Sort by date/time
      eligible.sort((a, b) => {
        const da = buildDateFromShift(a, a.startTime);
        const db_ = buildDateFromShift(b, b.startTime);
        return da - db_;
      });

      setShifts(eligible);

      // 2) Load any existing timesheets for this staff
      const tsRef = collection(db, "timesheets");
      const qTs = query(tsRef, where("staffId", "==", currentUser.uid));
      const tsSnap = await getDocs(qTs);

      const map = {};
      tsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.shiftId) {
          map[data.shiftId] = { id: docSnap.id, ...data };
        }
      });

      setTimesheetsByShiftId(map);
    } catch (err) {
      console.error("Error loading timesheets/shifts:", err);
      setError("Could not load your timesheets. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const now = useMemo(() => new Date(), []);

  // Prepares form when opening a shift
  const openTimesheetForm = (shift) => {
    setActiveShiftId(shift.id);

    const todayStr = new Date().toISOString().slice(0, 10);

    const existing = timesheetsByShiftId[shift.id];
    setForm({
      breakMinutes:
        existing?.breakMinutesStaff?.toString() ??
        existing?.breakMinutes?.toString() ??
        "0",
      clientName: existing?.clientName || "",
      clientRole: existing?.clientRole || "",
      clientSignedDate:
        existing?.clientSignedDate ||
        (existing?.clientSignedAt?.toDate
          ? existing.clientSignedAt.toDate().toISOString().slice(0, 10)
          : todayStr),
      staffDeclaration: !!existing?.staffDeclaration,
      staffSignedName:
        existing?.staffSignedName ||
        currentUser.displayName ||
        currentUser.email ||
        "",
      paperFileName: existing?.paperFileName || "",
    });
  };

  const closeTimesheetForm = () => {
    setActiveShiftId(null);
    setSaving(false);
  };

  const handleInputChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Can the timesheet be filled / submitted now?
  const canEditShiftTimesheet = (shift) => {
    const end = buildDateFromShift(shift, shift.endTime);
    const openFrom = new Date(end.getTime() - 30 * 60 * 1000); // 30 minutes before end
    const current = new Date();
    return current >= openFrom;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser || !activeShiftId) return;

    const shift = shifts.find((s) => s.id === activeShiftId);
    if (!shift) return;

    // Validation
    if (!form.clientName || !form.clientRole) {
      alert("Please enter client name and role.");
      return;
    }
    if (!form.clientSignedDate) {
      alert("Please select the client sign date.");
      return;
    }
    const breakMinutesNumber = Number(form.breakMinutes);
    if (Number.isNaN(breakMinutesNumber) || breakMinutesNumber < 0) {
      alert("Break must be a number of minutes (0 or more).");
      return;
    }
    if (!form.staffDeclaration) {
      alert(
        "Please tick the declaration to confirm your timesheet before submitting."
      );
      return;
    }
    if (!form.staffSignedName) {
      alert("Please enter your name in the staff signature field.");
      return;
    }

    try {
      setSaving(true);

      const startDate = buildDateFromShift(shift, shift.startTime);
      const endDate = buildDateFromShift(shift, shift.endTime);
      const hoursWorked = calculateWorkedHours(
        startDate,
        endDate,
        breakMinutesNumber
      );

      const tsId = `${shift.id}_${currentUser.uid}`;
      const tsRef = doc(db, "timesheets", tsId);

      const existingTs = timesheetsByShiftId[shift.id];

      // Work out staff & client rate from shift (fallback to any existing TS or legacy hourlyRate)
      const staffRate =
        typeof shift.staffRate === "number"
          ? shift.staffRate
          : typeof existingTs?.staffRate === "number"
          ? existingTs.staffRate
          : typeof shift.hourlyRate === "number"
          ? shift.hourlyRate
          : null;

      const clientRate =
        typeof shift.clientRate === "number"
          ? shift.clientRate
          : typeof existingTs?.clientRate === "number"
          ? existingTs.clientRate
          : null;

      // We always set status to "submitted"; admin will later approve & adjust.
      await setDoc(
        tsRef,
        {
          shiftId: shift.id,
          staffId: currentUser.uid,
          staffEmail: currentUser.email || null,

          // shift snapshot
          shiftLocation: shift.location || null,
          shiftRole: shift.role || null,
          shiftDate: shift.date || null,
          shiftStartTime: shift.startTime || null,
          shiftEndTime: shift.endTime || null,

          // store the rates on the timesheet for Payroll/Invoices
          staffRate: staffRate,
          clientRate: clientRate,

          breakMinutesStaff: breakMinutesNumber,
          hoursWorkedStaff: hoursWorked,

          clientName: form.clientName,
          clientRole: form.clientRole,
          clientSignedDate: form.clientSignedDate,
          clientSignedAt: Timestamp.now(),

          staffDeclaration: true,
          staffSignedName: form.staffSignedName,
          staffSignedAt: Timestamp.now(),

          paperFileName: form.paperFileName || null,

          // admin will later set: status: "approved" and finalHours, adjusted breaks etc.
          status: "submitted",
          submittedAt: existingTs?.submittedAt || Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

      alert("Timesheet submitted to Unity admin for approval.");
      closeTimesheetForm();
      await loadData();
    } catch (err) {
      console.error("Error submitting timesheet:", err);
      alert("Could not submit timesheet. Please try again.");
      setSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="text-sm text-slate-600">
        Please sign in to view your timesheets.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base md:text-lg font-semibold text-slate-900">
          Timesheets
        </h2>
        <p className="text-xs md:text-sm text-slate-600">
          Complete timesheets for your booked shifts. Only shifts that have
          started will appear. Submission opens 30 minutes before the end of
          each shift.
        </p>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Loading timesheets…</div>
      ) : !shifts.length ? (
        <div className="text-sm text-slate-600">
          You don&apos;t have any eligible shifts yet. Your timesheets will
          appear here once you have booked and worked shifts.
        </div>
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => {
            const ts = timesheetsByShiftId[shift.id];
            const dateLabel = shift.date?.toDate
              ? shift.date.toDate().toLocaleDateString()
              : "";
            const canEdit = canEditShiftTimesheet(shift);
            const isActive = activeShiftId === shift.id;

            return (
              <div
                key={shift.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 text-xs md:text-sm">
                    <p className="font-semibold text-slate-900">
                      {shift.location}
                    </p>
                    <p className="text-[11px] md:text-xs text-slate-600">
                      {dateLabel} · {shift.startTime} – {shift.endTime}
                    </p>
                    {shift.role && (
                      <p className="text-[11px] md:text-xs text-slate-600">
                        Role:{" "}
                        <span className="font-semibold">{shift.role}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                        statusBadgeClasses(ts?.status)
                      }
                    >
                      {ts?.status ? ts.status : "not submitted"}
                    </span>
                    <button
                      type="button"
                      onClick={() => openTimesheetForm(shift)}
                      disabled={!canEdit}
                      className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {canEdit
                        ? ts
                          ? "View / update timesheet"
                          : "Fill timesheet"
                        : "Available later"}
                    </button>
                    {!canEdit && (
                      <p className="text-[10px] text-slate-500 text-right">
                        Timesheet opens 30 minutes before shift end.
                      </p>
                    )}
                  </div>
                </div>

                {/* Expanded form for this shift */}
                {isActive && (
                  <form
                    onSubmit={handleSubmit}
                    className="mt-2 border-t border-slate-200 pt-3 space-y-3 text-xs md:text-sm"
                  >
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="block mb-1 font-semibold">
                          Break taken (minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="uh-input"
                          value={form.breakMinutes}
                          onChange={(e) =>
                            handleInputChange("breakMinutes", e.target.value)
                          }
                          placeholder="e.g. 30"
                        />
                      </div>

                      <div>
                        <label className="block mb-1 font-semibold">
                          Client name *
                        </label>
                        <input
                          type="text"
                          className="uh-input"
                          value={form.clientName}
                          onChange={(e) =>
                            handleInputChange("clientName", e.target.value)
                          }
                        />
                      </div>

                      <div>
                        <label className="block mb-1 font-semibold">
                          Client role *
                        </label>
                        <input
                          type="text"
                          className="uh-input"
                          value={form.clientRole}
                          onChange={(e) =>
                            handleInputChange("clientRole", e.target.value)
                          }
                          placeholder="e.g. Ward Manager"
                        />
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="block mb-1 font-semibold">
                          Client sign date *
                        </label>
                        <input
                          type="date"
                          className="uh-input"
                          value={form.clientSignedDate}
                          onChange={(e) =>
                            handleInputChange(
                              "clientSignedDate",
                              e.target.value
                            )
                          }
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block mb-1 font-semibold">
                          Staff signature (type full name) *
                        </label>
                        <input
                          type="text"
                          className="uh-input"
                          value={form.staffSignedName}
                          onChange={(e) =>
                            handleInputChange(
                              "staffSignedName",
                              e.target.value
                            )
                          }
                          placeholder="Your full name"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="inline-flex items-start gap-2 text-[11px] md:text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.staffDeclaration}
                          onChange={(e) =>
                            handleInputChange(
                              "staffDeclaration",
                              e.target.checked
                            )
                          }
                          className="mt-0.5"
                        />
                        <span>
                          I confirm that the hours recorded on this timesheet
                          are true and correct, that the client representative
                          has approved the shift, and that I have complied with
                          Unity Healthcare Staffing&apos;s policies and
                          procedures.
                        </span>
                      </label>
                    </div>

                    <div className="space-y-1">
                      <label className="block mb-1 font-semibold">
                        Upload paper timesheet (optional)
                      </label>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          handleInputChange(
                            "paperFileName",
                            file ? file.name : ""
                          );
                        }}
                        className="text-[11px] md:text-xs"
                      />
                      {form.paperFileName && (
                        <p className="text-[11px] text-slate-500">
                          Selected file: {form.paperFileName}
                          <br />
                          (File name will be stored with the timesheet. Upload
                          to Unity&apos;s secure storage can be added later.)
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-1.5 rounded-full bg-cyan-700 text-white text-xs md:text-sm font-semibold hover:bg-cyan-800 disabled:opacity-60"
                      >
                        {saving ? "Submitting…" : "Submit timesheet"}
                      </button>
                      <button
                        type="button"
                        onClick={closeTimesheetForm}
                        className="px-4 py-1.5 rounded-full border border-slate-300 bg-slate-50 text-xs md:text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Local input styles */}
      <style>{`
        .uh-input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          outline: none;
          font-size: 0.8rem;
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
