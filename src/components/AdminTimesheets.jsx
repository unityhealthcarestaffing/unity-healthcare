// src/components/AdminTimesheets.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
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

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toGBDate(tsLike) {
  try {
    const d =
      tsLike?.toDate && typeof tsLike.toDate === "function"
        ? tsLike.toDate()
        : tsLike instanceof Date
        ? tsLike
        : null;
    return d ? d.toLocaleString("en-GB") : "";
  } catch {
    return "";
  }
}

// ✅ Safe URL check (prevents rendering weird values as links)
function isProbablyUrl(v) {
  const s = safeStr(v);
  return /^https?:\/\//i.test(s);
}

// ✅ Robust reader for uploaded-doc fields (supports different schemas)
function readUploadedEvidence(ts) {
  const paperUrl =
    ts?.paperFileUrl ||
    ts?.paperTimesheetUrl ||
    ts?.paperUrl ||
    ts?.uploadedFileUrl ||
    "";

  const sigUrl =
    ts?.clientSignatureUrl ||
    ts?.signatureUrl ||
    ts?.clientSigUrl ||
    "";

  const paperName =
    ts?.paperFileName ||
    ts?.paperTimesheetName ||
    ts?.uploadedFileName ||
    "";

  const sigName =
    ts?.clientSignatureFileName ||
    ts?.signatureFileName ||
    "";

  // if you also store storage paths, keep them visible for debugging
  const paperPath =
    ts?.paperStoragePath ||
    ts?.paperFilePath ||
    ts?.uploadedFilePath ||
    "";

  const sigPath =
    ts?.clientSignatureStoragePath ||
    ts?.signatureStoragePath ||
    "";

  return {
    paperUrl: safeStr(paperUrl),
    sigUrl: safeStr(sigUrl),
    paperName: safeStr(paperName),
    sigName: safeStr(sigName),
    paperPath: safeStr(paperPath),
    sigPath: safeStr(sigPath),
  };
}

/* ------------------------------------------------------------------ */
/* ✅ Shift ID helpers (non-breaking, supports your schema variations) */
/* ------------------------------------------------------------------ */

// Prefer explicit public shift id stored on timesheet, then try shift doc's shiftId/publicId,
// and finally fall back to internal shiftId (doc id) shortened.
function getShiftIdDisplay(ts) {
  const publicId =
    safeStr(ts?.shiftPublicId) ||
    safeStr(ts?.shiftIdPublic) ||
    safeStr(ts?.shiftIDPublic) ||
    safeStr(ts?.publicShiftId);

  if (publicId) return publicId;

  // Sometimes timesheets may store the shift's generated ID in "shiftId" (SH-000001) by older schema
  const maybePublicInShiftId = safeStr(ts?.shiftId);
  if (/^SH-\d{6}$/i.test(maybePublicInShiftId)) return maybePublicInShiftId.toUpperCase();

  // Otherwise shiftId is your internal Firestore doc id
  const internal = safeStr(ts?.shiftId);
  if (!internal) return "—";
  return internal.slice(0, 8).toUpperCase();
}

// Best-effort client label for sorting and display.
// Uses explicit clientName on timesheet if you later add it; otherwise uses location as fallback.
// (Does NOT change your backend / rules. Pure UI helper.)
function getClientSortKey(ts) {
  const name =
    safeStr(ts?.clientName) ||
    safeStr(ts?.clientOrganisation) ||
    safeStr(ts?.clientOrgName) ||
    safeStr(ts?.organisation) ||
    safeStr(ts?.shiftLocation) ||
    "";
  return name.toLowerCase();
}

export default function AdminTimesheets({ currentUser, adminAccess }) {
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

  // ✅ sort controls (client requested)
  const [sortBy, setSortBy] = useState("submittedAt"); // submittedAt | shiftDate | status | location | staff | client | shiftId
  const [sortDirection, setSortDirection] = useState("desc"); // asc | desc

  // ---- approver identity (props OR firebase auth fallback)
  const approver = useMemo(() => {
    const authUser = getAuth()?.currentUser || null;
    const u = currentUser || authUser;

    const email = safeStr(u?.email);
    const name =
      safeStr(u?.displayName) ||
      safeStr(u?.name) ||
      safeStr(u?.fullName) ||
      (email ? email.split("@")[0] : "");

    return {
      email: email || "",
      name: name || "",
      label: name || email || "Unity Admin",
    };
  }, [currentUser]);

  const timesheetViewScope = adminAccess?.isSuperAdmin
    ? "all"
    : safeStr(
        adminAccess?.permissions?.timesheets?.view
      ).toLowerCase() || "none";

  const timesheetApproveScope = adminAccess?.isSuperAdmin
    ? "all"
    : safeStr(
        adminAccess?.permissions?.timesheets?.approve
      ).toLowerCase() || "none";

  const assignedClientIds = useMemo(() => {
    const values = Array.isArray(
      adminAccess?.assignedClientIds
    )
      ? adminAccess.assignedClientIds
      : [];

    return [
      ...new Set(
        values
          .map((value) => safeStr(value))
          .filter(Boolean)
      ),
    ];
  }, [adminAccess]);

  const assignedClientKey =
    assignedClientIds.join("|");

  const canApproveTimesheet = (timesheet) => {
    if (timesheetApproveScope === "all") {
      return true;
    }

    if (timesheetApproveScope !== "assigned") {
      return false;
    }

    return assignedClientIds.includes(
      safeStr(timesheet?.clientId)
    );
  };

  // Load only timesheets permitted by the administrator scope.
  const loadTimesheets = async () => {
    setLoading(true);
    setError("");

    try {
      const tsRef = collection(db, "timesheets");
      let rows = [];

      if (timesheetViewScope === "all") {
        const snapshot = await getDocs(
          query(
            tsRef,
            orderBy("submittedAt", "desc")
          )
        );

        rows = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
      } else if (timesheetViewScope === "assigned") {
        if (assignedClientIds.length === 0) {
          setTimesheets([]);
          return;
        }

        const snapshots = await Promise.all(
          assignedClientIds.map((clientId) =>
            getDocs(
              query(
                tsRef,
                where("clientId", "==", clientId)
              )
            )
          )
        );

        const uniqueRows = new Map();

        snapshots.forEach((snapshot) => {
          snapshot.docs.forEach((item) => {
            uniqueRows.set(item.id, {
              id: item.id,
              ...item.data(),
            });
          });
        });

        rows = [...uniqueRows.values()];
      } else {
        setTimesheets([]);
        setError(
          "You do not have permission to view admin timesheets."
        );
        return;
      }

      setTimesheets(rows);
    } catch (err) {
      console.error(
        "Error loading timesheets for admin:",
        err
      );
      setError(
        "Could not load timesheets. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimesheets();
  }, [timesheetViewScope, assignedClientKey]);

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
    const permissionTarget =
      timesheets.find(
        (item) => item.id === activeId
      ) || null;

    if (!canApproveTimesheet(permissionTarget)) {
      if (
        e &&
        typeof e.preventDefault === "function"
      ) {
        e.preventDefault();
      }

      alert(
        "You do not have permission to update this timesheet."
      );
      return;
    }

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

    const nextStatus = form.status || "submitted";
    const prevStatus = String(ts.status || "submitted");

    // Final hours used by Payroll:
    // prefer admin override, then staff hours
    const finalHours =
      hoursWorkedAdmin != null
        ? hoursWorkedAdmin
        : ts.hoursWorkedStaff != null
        ? ts.hoursWorkedStaff
        : null;

    // Detect approval transition
    const becomesApproved = prevStatus !== "approved" && nextStatus === "approved";
    const staysApproved = prevStatus === "approved" && nextStatus === "approved";
    const leavingApproved = prevStatus === "approved" && nextStatus !== "approved";

    try {
      setSaving(true);

      const tsRef = doc(db, "timesheets", activeId);

      const payload = {
        breakMinutesAdmin: breakMinutesAdmin != null ? breakMinutesAdmin : null,
        hoursWorkedAdmin: hoursWorkedAdmin != null ? hoursWorkedAdmin : null,
        finalHours: finalHours != null ? finalHours : null,

        adminNote: form.adminNote || null,
        status: nextStatus,

        updatedAt: Timestamp.now(),

        // helpful audit fields
        updatedByEmail: approver.email || null,
        updatedByName: approver.name || null,
        updatedBy: approver.label || null,
      };

      // ✅ If approving now: write approver identity and approvedAt
      if (becomesApproved) {
        payload.approvedAt = Timestamp.now();
        payload.approvedByEmail = approver.email || null;
        payload.approvedByName = approver.name || null;
        payload.approvedBy = approver.label || "Unity Admin";
      }

      // ✅ If already approved and still approved: DO NOT overwrite approver
      if (staysApproved) {
        // keep existing approvedAt/by fields untouched (no-op)
      }

      // ✅ If moving away from approved: clear approval fields
      if (leavingApproved) {
        payload.approvedAt = null;
        payload.approvedByEmail = null;
        payload.approvedByName = null;
        payload.approvedBy = null;
      }

      await setDoc(tsRef, payload, { merge: true });

      alert("Timesheet updated.");
      closeRow();
      await loadTimesheets();
    } catch (err) {
      console.error("Error updating timesheet:", err);
      alert("Could not update timesheet. Please try again.");
      setSaving(false);
    }
  };

  // ✅ sorted view (client requested "add sort by")
  const sortedTimesheets = useMemo(() => {
    const list = [...timesheets];

    const getTime = (v) => {
      const d =
        v?.toDate && typeof v.toDate === "function"
          ? v.toDate()
          : v instanceof Date
          ? v
          : null;
      return d ? d.getTime() : 0;
    };

    const dir = sortDirection === "asc" ? 1 : -1;

    list.sort((a, b) => {
      let av;
      let bv;

      if (sortBy === "shiftDate") {
        av = getTime(a.shiftDate);
        bv = getTime(b.shiftDate);
      } else if (sortBy === "status") {
        av = safeStr(a.status).toLowerCase();
        bv = safeStr(b.status).toLowerCase();
      } else if (sortBy === "location") {
        av = safeStr(a.shiftLocation).toLowerCase();
        bv = safeStr(b.shiftLocation).toLowerCase();
      } else if (sortBy === "staff") {
        av = safeStr(a.staffSignedName || a.staffEmail || a.staffId).toLowerCase();
        bv = safeStr(b.staffSignedName || b.staffEmail || b.staffId).toLowerCase();
      } else if (sortBy === "client") {
        av = getClientSortKey(a);
        bv = getClientSortKey(b);
      } else if (sortBy === "shiftId") {
        av = safeStr(getShiftIdDisplay(a)).toLowerCase();
        bv = safeStr(getShiftIdDisplay(b)).toLowerCase();
      } else {
        // submittedAt (default)
        av = getTime(a.submittedAt);
        bv = getTime(b.submittedAt);
      }

      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return list;
  }, [timesheets, sortBy, sortDirection]);

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
        <p className="text-[11px] text-slate-500 mt-1">
          Signed in as:{" "}
          <span className="font-semibold">{approver.label || "Admin"}</span>
        </p>
      </div>

      {/* ✅ Sort row (added, does not remove anything) */}
      <div className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-slate-500">Sort</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-44"
          >
            <option value="submittedAt">Submitted date</option>
            <option value="shiftDate">Shift date</option>
            <option value="client">Client</option>
            <option value="shiftId">Shift ID</option>
            <option value="status">Status</option>
            <option value="location">Location</option>
            <option value="staff">Staff</option>
          </select>

          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-36"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Loading timesheets…</div>
      ) : !sortedTimesheets.length ? (
        <div className="text-sm text-slate-600">No timesheets found yet.</div>
      ) : (
        <div className="space-y-3">
          {sortedTimesheets.map((ts) => {
            const dateLabel = ts.shiftDate?.toDate
              ? ts.shiftDate.toDate().toLocaleDateString("en-GB")
              : "";

            const isOpen = activeId === ts.id;

            const staffHours = ts.hoursWorkedStaff ?? null;
            const finalHours =
              ts.finalHours ?? ts.hoursWorkedAdmin ?? ts.hoursWorkedStaff ?? null;

            const approvedBy =
              safeStr(ts.approvedByName) ||
              safeStr(ts.approvedByEmail) ||
              safeStr(ts.approvedBy) ||
              "";

            const approvedAt = ts.approvedAt ? toGBDate(ts.approvedAt) : "";

            // ✅ Shift ID display
            const shiftIdDisplay = getShiftIdDisplay(ts);

            // ✅ "Client" display (best-effort, non-breaking)
            const clientDisplay =
              safeStr(ts.clientName) ||
              safeStr(ts.clientOrganisation) ||
              safeStr(ts.clientOrgName) ||
              safeStr(ts.organisation) ||
              ""; // if missing, we just don't show it

            // ✅ Uploaded evidence links
            const evidence = readUploadedEvidence(ts);
            const paperLinkOk = isProbablyUrl(evidence.paperUrl);
            const sigLinkOk = isProbablyUrl(evidence.sigUrl);

            return (
              <div
                key={ts.id} // ✅ fixes key warning for this list
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 text-xs md:text-sm">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">
                      {ts.shiftLocation || "No location"}
                    </p>

                    {/* ✅ Shift ID + (optional) client label (added, non-breaking) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] md:text-xs text-slate-600">
                      <span>
                        Shift ID:{" "}
                        <span className="font-semibold text-slate-800">
                          {shiftIdDisplay}
                        </span>
                      </span>
                      {clientDisplay ? (
                        <span>
                          · Client:{" "}
                          <span className="font-semibold text-slate-800">
                            {clientDisplay}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[11px] md:text-xs text-slate-600">
                      {dateLabel} · {ts.shiftStartTime} – {ts.shiftEndTime}
                    </p>
                    {ts.shiftRole && (
                      <p className="text-[11px] md:text-xs text-slate-600">
                        Role: <span className="font-semibold">{ts.shiftRole}</span>
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
                        <span className="font-semibold">{finalHours} h</span>
                      </p>
                    )}

                    {String(ts.status || "").toLowerCase() === "approved" && (
                      <p className="text-[11px] md:text-xs text-slate-600">
                        Approved by:{" "}
                        <span className="font-semibold">{approvedBy || "—"}</span>
                        {approvedAt ? (
                          <>
                            {" "}
                            · <span className="text-slate-500">{approvedAt}</span>
                          </>
                        ) : null}
                      </p>
                    )}

                    {/* ✅ Evidence row */}
                    {paperLinkOk || sigLinkOk ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {paperLinkOk && (
                          <a
                            href={evidence.paperUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-cyan-700 hover:underline"
                          >
                            View uploaded timesheet
                            {evidence.paperName ? ` (${evidence.paperName})` : ""}
                          </a>
                        )}
                        {sigLinkOk && (
                          <a
                            href={evidence.sigUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-cyan-700 hover:underline"
                          >
                            View client signature
                            {evidence.sigName ? ` (${evidence.sigName})` : ""}
                          </a>
                        )}
                      </div>
                    ) : (
                      // ✅ If no URLs found, show a hint (doesn't break anything)
                      <p className="text-[11px] text-slate-500 pt-1">
                        No uploaded documents found on this timesheet record.
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
                    {/* ✅ Evidence section inside the expanded view too */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-800 mb-1">
                        Uploaded evidence
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {paperLinkOk ? (
                          <a
                            href={evidence.paperUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-cyan-700 hover:underline"
                          >
                            View uploaded timesheet
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            No uploaded file URL found
                          </span>
                        )}

                        {sigLinkOk ? (
                          <a
                            href={evidence.sigUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-cyan-700 hover:underline"
                          >
                            View client signature
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            No signature URL found
                          </span>
                        )}
                      </div>

                      {(evidence.paperPath || evidence.sigPath) && (
                        <div className="mt-2 text-[10px] text-slate-500 space-y-0.5">
                          {evidence.paperPath && (
                            <div>File path: {evidence.paperPath}</div>
                          )}
                          {evidence.sigPath && (
                            <div>Signature path: {evidence.sigPath}</div>
                          )}
                        </div>
                      )}
                    </div>

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
                            handleChange("breakMinutesAdmin", e.target.value)
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
                        <label className="block mb-1 font-semibold">Status</label>
                        <select
                          className="uh-input"
                          value={form.status}
                          onChange={(e) => handleChange("status", e.target.value)}
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
                        onChange={(e) => handleChange("adminNote", e.target.value)}
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
