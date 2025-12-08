// src/components/AdminTimesheets.jsx
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// Same badge styling as staff Timesheets
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

export default function AdminTimesheets() {
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    breakMinutesAdmin: "",
    hoursWorkedAdmin: "",
    status: "submitted",
    adminNote: "",
  });

  // Load all timesheets ordered by submittedAt desc
  const loadTimesheets = async () => {
    setLoading(true);
    setError("");

    try {
      const tsRef = collection(db, "timesheets");
      const qTs = query(tsRef, orderBy("submittedAt", "desc"));
      const snap = await getDocs(qTs);

      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setTimesheets(rows);
    } catch (err) {
      console.error("Error loading timesheets for admin:", err);
      setError("Could not load timesheets. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimesheets();
  }, []);

  const openRow = (ts) => {
    setActiveId(ts.id);
    setForm({
      breakMinutesAdmin:
        ts.breakMinutesAdmin != null ? String(ts.breakMinutesAdmin) : "",
      hoursWorkedAdmin:
        ts.hoursWorkedAdmin != null ? String(ts.hoursWorkedAdmin) : "",
      status: ts.status || "submitted",
      adminNote: ts.adminNote || "",
    });
  };

  const closeRow = () => {
    setActiveId(null);
    setSaving(false);
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeId) return;

    const ts = timesheets.find((t) => t.id === activeId);
    if (!ts) return;

    const breakMinutesAdmin = form.breakMinutesAdmin.trim()
      ? Number(form.breakMinutesAdmin)
      : null;
    const hoursWorkedAdmin = form.hoursWorkedAdmin.trim()
      ? Number(form.hoursWorkedAdmin)
      : null;

    if (
      breakMinutesAdmin != null &&
      (Number.isNaN(breakMinutesAdmin) || breakMinutesAdmin < 0)
    ) {
      alert("Break (admin) must be a number of minutes 0 or more.");
      return;
    }
    if (hoursWorkedAdmin != null && Number.isNaN(hoursWorkedAdmin)) {
      alert("Hours (admin) must be a valid number.");
      return;
    }

    const status = form.status || "submitted";

    // Final hours used by Payroll:
    // prefer admin override, then staff hours
    const finalHours =
      hoursWorkedAdmin != null
        ? hoursWorkedAdmin
        : ts.hoursWorkedStaff != null
        ? ts.hoursWorkedStaff
        : null;

    try {
      setSaving(true);

      const tsRef = doc(db, "timesheets", activeId);
      await setDoc(
        tsRef,
        {
          breakMinutesAdmin:
            breakMinutesAdmin != null ? breakMinutesAdmin : null,
          hoursWorkedAdmin:
            hoursWorkedAdmin != null ? hoursWorkedAdmin : null,
          finalHours: finalHours != null ? finalHours : null,

          adminNote: form.adminNote || null,
          status,
          updatedAt: Timestamp.now(),
          approvedAt: status === "approved" ? Timestamp.now() : null,
        },
        { merge: true }
      );

      alert("Timesheet updated.");
      closeRow();
      await loadTimesheets();
    } catch (err) {
      console.error("Error updating timesheet:", err);
      alert("Could not update timesheet. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base md:text-lg font-semibold text-slate-900">
          Admin – Timesheets
        </h2>
        <p className="text-xs md:text-sm text-slate-600">
          Review submitted timesheets, adjust breaks/hours, and approve or
          reject. Approved timesheets feed into Payroll.
        </p>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Loading timesheets…</div>
      ) : !timesheets.length ? (
        <div className="text-sm text-slate-600">
          No timesheets found yet.
        </div>
      ) : (
        <div className="space-y-3">
          {timesheets.map((ts) => {
            const dateLabel = ts.shiftDate?.toDate
              ? ts.shiftDate.toDate().toLocaleDateString()
              : "";
            const isOpen = activeId === ts.id;

            const staffHours = ts.hoursWorkedStaff ?? null;
            const finalHours =
              ts.finalHours ??
              ts.hoursWorkedAdmin ??
              ts.hoursWorkedStaff ??
              null;

            return (
              <div
                key={ts.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 text-xs md:text-sm">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">
                      {ts.shiftLocation || "No location"}
                    </p>
                    <p className="text-[11px] md:text-xs text-slate-600">
                      {dateLabel} · {ts.shiftStartTime} – {ts.shiftEndTime}
                    </p>
                    {ts.shiftRole && (
                      <p className="text-[11px] md:text-xs text-slate-600">
                        Role:{" "}
                        <span className="font-semibold">{ts.shiftRole}</span>
                      </p>
                    )}
                    <p className="text-[11px] md:text-xs text-slate-600">
                      Staff:{" "}
                      <span className="font-semibold">
                        {ts.staffSignedName || ts.staffEmail || ts.staffId}
                      </span>
                    </p>
                    <p className="text-[11px] md:text-xs text-slate-600">
                      Staff hours (calc):{" "}
                      <span className="font-semibold">
                        {staffHours != null ? `${staffHours} h` : "n/a"}
                      </span>
                    </p>
                    {finalHours != null && (
                      <p className="text-[11px] md:text-xs text-emerald-700">
                        Final hours for payroll:{" "}
                        <span className="font-semibold">
                          {finalHours} h
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                        statusBadgeClasses(ts.status)
                      }
                    >
                      {ts.status || "submitted"}
                    </span>
                    <button
                      type="button"
                      onClick={() => openRow(ts)}
                      className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    >
                      Review / adjust
                    </button>
                  </div>
                </div>

                {/* Expanded admin edit form */}
                {isOpen && (
                  <form
                    onSubmit={handleSave}
                    className="mt-2 border-t border-slate-200 pt-3 space-y-3 text-xs md:text-sm"
                  >
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="block mb-1 font-semibold">
                          Break (admin, minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="uh-input"
                          value={form.breakMinutesAdmin}
                          onChange={(e) =>
                            handleChange(
                              "breakMinutesAdmin",
                              e.target.value
                            )
                          }
                          placeholder="Leave blank to use staff break"
                        />
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Staff claimed:{" "}
                          {ts.breakMinutesStaff != null
                            ? `${ts.breakMinutesStaff} min`
                            : "n/a"}
                        </p>
                      </div>

                      <div>
                        <label className="block mb-1 font-semibold">
                          Hours (admin override)
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          className="uh-input"
                          value={form.hoursWorkedAdmin}
                          onChange={(e) =>
                            handleChange("hoursWorkedAdmin", e.target.value)
                          }
                          placeholder="Leave blank to use staff hours"
                        />
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Staff calc:{" "}
                          {staffHours != null ? `${staffHours} h` : "n/a"}
                        </p>
                      </div>

                      <div>
                        <label className="block mb-1 font-semibold">
                          Status
                        </label>
                        <select
                          className="uh-input"
                          value={form.status}
                          onChange={(e) =>
                            handleChange("status", e.target.value)
                          }
                        >
                          <option value="submitted">Submitted</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Only <span className="font-semibold">approved</span>{" "}
                          timesheets appear in Payroll.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block mb-1 font-semibold">
                        Admin note (optional)
                      </label>
                      <textarea
                        className="uh-input"
                        rows={2}
                        value={form.adminNote}
                        onChange={(e) =>
                          handleChange("adminNote", e.target.value)
                        }
                        placeholder="Reason for adjustment / rejection etc."
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-1.5 rounded-full bg-cyan-700 text-white text-xs md:text-sm font-semibold hover:bg-cyan-800 disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={closeRow}
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
