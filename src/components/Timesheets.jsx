// src/components/Timesheets.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, functions, storage } from "../firebaseConfig";

// Build a JS Date from a shift's Firestore date + "HH:MM"
function buildDateFromShift(shift, timeStr) {
  const base =
    shift?.date?.toDate && typeof shift.date.toDate === "function"
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
  if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000; // crossed midnight

  const totalMinutes = diffMs / (1000 * 60);
  const breakMins = Math.max(0, Number(breakMinutes) || 0);
  const worked = Math.max(0, totalMinutes - breakMins);
  const hours = worked / 60;

  return Math.round(hours * 4) / 4; // nearest 0.25
}

// Timesheet status badge styling
function statusBadgeClasses(status) {
  switch (String(status || "").toLowerCase()) {
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

// 30 minutes before shift end
function getOpenFromDate(shift) {
  const end = buildDateFromShift(shift, shift.endTime);
  return new Date(end.getTime() - 30 * 60 * 1000);
}

function formatOpenFromLabel(openFrom) {
  try {
    return openFrom.toLocaleString();
  } catch {
    return String(openFrom);
  }
}

// Merge query results by doc.id (avoid duplicates)
function mergeDocsById(...docArrays) {
  const map = new Map();
  docArrays.flat().forEach((d) => map.set(d.id, d));
  return Array.from(map.values());
}

// Decode callable errors so you don’t just see “internal”
function decodeCallableError(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  const cleaned = message.replace(/^FirebaseError:\s*/i, "").trim();
  if (code) return { code, message: cleaned || message || "Request failed." };
  return { code: "unknown", message: cleaned || "Request failed." };
}

/**
 * Get approver name/email from timesheet doc (read-only)
 */
function getApproverLabel(ts) {
  if (!ts) return "";

  const status = String(ts.status || "").toLowerCase();
  if (status !== "approved" && status !== "rejected") return "";

  const byName = String(ts.approvedByName || "").trim();
  const byEmail = String(ts.approvedByEmail || "").trim();
  const by = String(ts.approvedBy || "").trim();

  return byName || byEmail || by || "";
}

// Safe filename
function safeName(name) {
  const s = String(name || "file").trim();
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(0, 120) || "file";
}

// Convert dataURL -> Blob
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function Timesheets({ currentUser }) {
  const [shifts, setShifts] = useState([]);
  const [timesheetsByShiftId, setTimesheetsByShiftId] = useState({});
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [activeShiftId, setActiveShiftId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [paperFile, setPaperFile] = useState(null);

  // ✅ Client signature pad state
  const canvasRef = useRef(null);
  const [clientSigDataUrl, setClientSigDataUrl] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);

  // ✅ Focus mode: show only the timesheet being signed/submitted
  const [focusMode, setFocusMode] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const [form, setForm] = useState({
    breakMinutes: "0",
    clientName: "",
    clientRole: "",
    clientSignedDate: "",
    staffDeclaration: false,
    staffSignedName: "",
    paperFileName: "",
  });

  const uid = currentUser?.uid || null;

  // ✅ time tick so items move sections automatically (Available later -> Needs action)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // ✅ used to re-run timesheets query cutoff (availableAt <= now) as time passes
  const nowBucket = useMemo(() => Math.floor(now.getTime() / 60_000), [now]);

  const submitTimesheetCallable = useMemo(() => {
    return httpsCallable(functions, "submitTimesheetV2");
  }, []);

  // ✅ tolerant helper: find timesheet by shift docId OR shift public code
  function getTimesheetForShift(shift, map) {
    if (!shift || !map) return null;

    // 1) primary: Firestore shift doc id
    if (shift.id && map[shift.id]) return map[shift.id];

    // 2) also accept shift.shiftId (your public id stored on shift doc)
    const publicId = String(shift.shiftId || "").trim();
    if (publicId && map[publicId]) return map[publicId];

    return null;
  }

  const canEditShiftTimesheet = (shift) => {
    const openFrom = getOpenFromDate(shift);
    return now >= openFrom;
  };

  const clearSignatureCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  const openTimesheetForm = (shift) => {
    setActiveShiftId(shift.id);
    setFocusMode(true);

    // keep URL in sync (safe)
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("shiftId", shift.id);
      window.history.replaceState({}, "", url.toString());
    } catch {}

    setPaperFile(null);

    // reset signature
    setClientSigDataUrl("");
    clearSignatureCanvas();

    const todayStr = new Date().toISOString().slice(0, 10);

    // ✅ tolerant lookup
    const existing = getTimesheetForShift(shift, timesheetsByShiftId);

    const approverLabel = getApproverLabel(existing);

    setForm({
      breakMinutes:
        existing?.breakMinutesStaff?.toString() ??
        existing?.breakMinutes?.toString() ??
        "0",

      clientName: approverLabel || existing?.clientName || "",
      clientRole: existing?.clientRole || "",
      clientSignedDate:
        existing?.clientSignedDate ||
        (existing?.clientSignedAt?.toDate
          ? existing.clientSignedAt.toDate().toISOString().slice(0, 10)
          : todayStr),

      staffDeclaration: !!existing?.staffDeclaration,
      staffSignedName:
        existing?.staffSignedName ||
        currentUser?.displayName ||
        currentUser?.email ||
        "",
      paperFileName: existing?.paperFileName || "",
    });
  };

  const closeTimesheetForm = () => {
    setActiveShiftId(null);
    setSaving(false);
    setPaperFile(null);
    setClientSigDataUrl("");
    setIsDrawing(false);
    setFocusMode(false);

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("shiftId");
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  // ✅ Auto-open from URL: /timesheets?shiftId=...
  useEffect(() => {
    if (loading) return;
    if (autoOpened) return;

    const params = new URLSearchParams(window.location.search);
    const shiftId = params.get("shiftId");
    if (!shiftId) return;

    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;

    openTimesheetForm(shift);
    setAutoOpened(true);
    setFocusMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, shifts, autoOpened]);

  const handleInputChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const activeShift = useMemo(
    () => shifts.find((s) => s.id === activeShiftId) || null,
    [activeShiftId, shifts]
  );

  const activeTs = useMemo(() => {
    if (!activeShift) return null;
    return getTimesheetForShift(activeShift, timesheetsByShiftId);
  }, [activeShift, timesheetsByShiftId]);

  const isApprovedLocked = useMemo(() => {
    const st = String(activeTs?.status || "").toLowerCase();
    return st === "approved";
  }, [activeTs]);

  async function uploadPaperTimesheetIfAny({ uid, shiftId, file }) {
    if (!file)
      return { paperFileName: null, paperStoragePath: null, paperFileUrl: null };

    const name = safeName(file.name);
    const ts = Date.now();
    const storagePath = `timesheets/${uid}/${shiftId}/${ts}-${name}`;

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    });

    const url = await getDownloadURL(storageRef);

    return {
      paperFileName: name,
      paperStoragePath: storagePath,
      paperFileUrl: url,
    };
  }

  async function uploadClientSignatureIfAny({ uid, shiftId, dataUrl }) {
    if (!dataUrl) {
      return { clientSignatureUrl: null, clientSignatureStoragePath: null };
    }

    const ts = Date.now();
    const blob = dataUrlToBlob(dataUrl);
    const storagePath = `timesheets/${uid}/${shiftId}/${ts}-clientSignature.png`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, blob, { contentType: "image/png" });

    const url = await getDownloadURL(storageRef);
    return { clientSignatureUrl: url, clientSignatureStoragePath: storagePath };
  }

  // ✅ Signature pad handlers
  const ensureCanvasReady = () => {
    const c = canvasRef.current;
    if (!c) return null;

    // fixed size
    if (c.width !== 520) c.width = 520;
    if (c.height !== 160) c.height = 160;

    const ctx = c.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";

    // white background once
    if (!clientSigDataUrl) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
    }

    return { c, ctx };
  };

  const getCanvasPoint = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    if (isApprovedLocked) return;
    const ready = ensureCanvasReady();
    if (!ready) return;
    const { c, ctx } = ready;

    const p = getCanvasPoint(e, c);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setIsDrawing(true);
  };

  const moveDraw = (e) => {
    if (!isDrawing || isApprovedLocked) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const p = getCanvasPoint(e, c);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault?.();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const c = canvasRef.current;
    if (!c) return;
    setClientSigDataUrl(c.toDataURL("image/png"));
  };

  const clearSignature = () => {
    if (isApprovedLocked) return;
    clearSignatureCanvas();
    setClientSigDataUrl("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!uid || !activeShiftId) return;

    const shift = activeShift;
    if (!shift) return;

    if (!canEditShiftTimesheet(shift)) {
      alert("Timesheet is not open yet. It opens 30 minutes before shift end.");
      return;
    }

    if (isApprovedLocked) {
      alert("This timesheet is already approved and cannot be re-submitted.");
      return;
    }

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
      calculateWorkedHours(startDate, endDate, breakMinutesNumber);

      const uploadedPaper = await uploadPaperTimesheetIfAny({
        uid,
        shiftId: shift.id,
        file: paperFile,
      });

      const uploadedSig = await uploadClientSignatureIfAny({
        uid,
        shiftId: shift.id,
        dataUrl: clientSigDataUrl,
      });

      const res = await submitTimesheetCallable({
        shiftId: shift.id,
        breakMinutes: breakMinutesNumber,
        clientName: form.clientName,
        clientRole: form.clientRole,
        clientSignedDate: form.clientSignedDate,
        staffDeclaration: true,
        staffSignedName: form.staffSignedName,

        paperFileName: uploadedPaper.paperFileName,
        paperStoragePath: uploadedPaper.paperStoragePath,
        paperFileUrl: uploadedPaper.paperFileUrl,

        clientSignatureUrl: uploadedSig.clientSignatureUrl,
        clientSignatureStoragePath: uploadedSig.clientSignatureStoragePath,
      });

      const ok = !!res?.data?.ok;
      if (!ok) {
        throw new Error(res?.data?.message || "Could not submit timesheet.");
      }

      alert("Timesheet submitted to Unity admin for approval.");
      closeTimesheetForm();
      // live listeners will refresh automatically
    } catch (err) {
      console.error("Error submitting timesheet:", err);

      const { code, message } = decodeCallableError(err);

      const friendly =
        code.includes("unauthenticated") ||
        code.includes("functions/unauthenticated")
          ? "Please sign in again and retry."
          : code.includes("permission-denied") ||
            code.includes("functions/permission-denied")
          ? "Permission denied. Please contact Unity admin."
          : code.includes("failed-precondition") ||
            code.includes("functions/failed-precondition")
          ? message ||
            "Timesheet is not open yet. It opens 30 minutes before shift end."
          : code.includes("not-found") || code.includes("functions/not-found")
          ? "submitTimesheetV2 is not deployed (function not found). Deploy functions and retry."
          : message || "Could not submit timesheet. Please try again.";

      alert(friendly);
      setSaving(false);
    }
  };

  // ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ LIVE DATA: current and legacy shift ownership fields
  useEffect(() => {
    if (!uid) {
      setShifts([]);
      setTimesheetsByShiftId({});
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");
    setInfo("");

    const shiftsRef =
      collection(db, "shifts");

    const userEmail = String(
      currentUser?.email || ""
    ).trim();

    const ownershipQueries = [
      ["bookedBy", uid],
      ["bookedStaffId", uid],
      ["requestedStaffId", uid],
      ["staffBookedBy", uid],
      ["staffBooking.staffId", uid],
      ["staffBooking.uid", uid],
    ];

    if (userEmail) {
      ownershipQueries.push(
        ["bookedStaffEmail", userEmail],
        ["requestedStaffEmail", userEmail],
        ["staffBooking.email", userEmail]
      );
    }

    const state = {
      active: true,
      queryMaps: new Map(),
      pendingShiftListeners:
        ownershipQueries.length,
      timesheetsReady: false,
      timesheetsMap: {},
      shiftUnsubscribers: [],
      timesheetUnsubscriber: null,
    };

    const recomputeEligibleShifts = () => {
      if (!state.active) return;

      const mergedById = new Map();

      state.queryMaps.forEach(
        (resultMap) => {
          resultMap.forEach(
            (shift, id) => {
              mergedById.set(id, shift);
            }
          );
        }
      );

      const nowLocal = new Date();

      const eligible = [
        ...mergedById.values(),
      ].filter((shift) => {
        const status = String(
          shift.status || ""
        )
          .trim()
          .toLowerCase();

        if (
          status !== "booked" &&
          status !== "completed"
        ) {
          return false;
        }

        const start =
          buildDateFromShift(
            shift,
            shift.startTime
          );

        return (
          start instanceof Date &&
          !Number.isNaN(start.getTime()) &&
          start <= nowLocal
        );
      });

      eligible.sort((first, second) => {
        const firstDate =
          buildDateFromShift(
            first,
            first.startTime
          );

        const secondDate =
          buildDateFromShift(
            second,
            second.startTime
          );

        return firstDate - secondDate;
      });

      setShifts(eligible);

      if (
        eligible.length > 0 &&
        Object.keys(
          state.timesheetsMap || {}
        ).length === 0
      ) {
        setInfo(
          "Timesheets open 30 minutes before the end of each shift."
        );
      } else {
        setInfo("");
      }
    };

    const finishLoadingIfReady = () => {
      if (
        state.active &&
        state.pendingShiftListeners === 0 &&
        state.timesheetsReady
      ) {
        setLoading(false);
      }
    };

    ownershipQueries.forEach(
      ([field, value], index) => {
        const resultKey =
          `${field}:${index}`;

        let initialResultCompleted =
          false;

        const completeInitialResult = () => {
          if (initialResultCompleted) {
            return;
          }

          initialResultCompleted = true;

          state.pendingShiftListeners =
            Math.max(
              0,
              state.pendingShiftListeners - 1
            );

          finishLoadingIfReady();
        };

        const ownershipQuery = query(
          shiftsRef,
          where(field, "==", value)
        );

        const unsubscribe = onSnapshot(
          ownershipQuery,
          (snapshot) => {
            if (!state.active) return;

            const resultMap = new Map();

            snapshot.docs.forEach(
              (document) => {
                resultMap.set(
                  document.id,
                  {
                    id: document.id,
                    ...document.data(),
                  }
                );
              }
            );

            state.queryMaps.set(
              resultKey,
              resultMap
            );

            recomputeEligibleShifts();
            completeInitialResult();
          },
          (err) => {
            console.error(
              `Timesheet shift listener ${field} error:`,
              err
            );

            if (!state.active) return;

            state.queryMaps.set(
              resultKey,
              new Map()
            );

            setError(
              "Some eligible shifts could not be loaded. Please refresh and try again."
            );

            recomputeEligibleShifts();
            completeInitialResult();
          }
        );

        state.shiftUnsubscribers.push(
          unsubscribe
        );
      }
    );

    const timesheetsRef =
      collection(db, "timesheets");

    const timesheetsQuery = query(
      timesheetsRef,
      where("staffId", "==", uid),
      where(
        "availableAt",
        "<=",
        Timestamp.fromDate(now)
      )
    );

    state.timesheetUnsubscriber =
      onSnapshot(
        timesheetsQuery,
        (snapshot) => {
          if (!state.active) return;

          const map = {};

          snapshot.docs.forEach(
            (document) => {
              const data =
                document.data();

              const row = {
                id: document.id,
                ...data,
              };

              const shiftDocumentId =
                String(
                  data.shiftId || ""
                ).trim();

              const shiftPublicId =
                String(
                  data.shiftPublicId || ""
                ).trim();

              if (shiftDocumentId) {
                map[shiftDocumentId] = row;
              }

              if (shiftPublicId) {
                map[shiftPublicId] = row;
              }
            }
          );

          state.timesheetsMap = map;
          state.timesheetsReady = true;

          setTimesheetsByShiftId(map);
          recomputeEligibleShifts();
          finishLoadingIfReady();
        },
        (err) => {
          console.error(
            "Timesheets listener error:",
            err
          );

          if (!state.active) return;

          state.timesheetsMap = {};
          state.timesheetsReady = true;

          setTimesheetsByShiftId({});

          setError(
            "Your timesheets could not be loaded. Please refresh and try again."
          );

          recomputeEligibleShifts();
          finishLoadingIfReady();
        }
      );

    return () => {
      state.active = false;

      state.shiftUnsubscribers.forEach(
        (unsubscribe) => {
          unsubscribe?.();
        }
      );

      state.timesheetUnsubscriber?.();
    };
  }, [uid, currentUser?.email, nowBucket]);

  // ✅ Grouped list view (does NOT change existing card behaviour)
  const grouped = useMemo(() => {
    const needsAction = [];
    const submittedApproved = [];
    const availableLater = [];

    for (const shift of shifts) {
      const ts = getTimesheetForShift(shift, timesheetsByShiftId);
      const canEdit = canEditShiftTimesheet(shift);
      const st = String(ts?.status || "").toLowerCase();

      const needs =
        canEdit && (!ts || st === "" || st === "rejected" || st === "draft");

      const done = !!ts && (st === "submitted" || st === "approved");
      const later = !canEdit;

      if (needs) needsAction.push(shift);
      else if (done) submittedApproved.push(shift);
      else if (later) availableLater.push(shift);
      else submittedApproved.push(shift); // safe fallback
    }

    return { needsAction, submittedApproved, availableLater };
  }, [shifts, timesheetsByShiftId, now]); // include now so it re-groups automatically

  const renderShiftCard = (shift) => {
    const ts = getTimesheetForShift(shift, timesheetsByShiftId);
    const dateLabel = shift.date?.toDate ? shift.date.toDate().toLocaleDateString() : "";

    const openFrom = getOpenFromDate(shift);
    const canEdit = canEditShiftTimesheet(shift);
    const isActive = activeShiftId === shift.id;

    return (
      <div
        key={shift.id}
        className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5 text-xs md:text-sm">
            <p className="font-semibold text-slate-900">{shift.location}</p>
            <p className="text-[11px] md:text-xs text-slate-600">
              {dateLabel} · {shift.startTime} – {shift.endTime}
            </p>
            {shift.role && (
              <p className="text-[11px] md:text-xs text-slate-600">
                Role: <span className="font-semibold">{shift.role}</span>
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
              {ts?.status ? ts.status : canEdit ? "available" : "locked"}
            </span>

            <button
              type="button"
              onClick={() => openTimesheetForm(shift)}
              disabled={!canEdit}
              className="text-[11px] md:text-xs px-3 py-1 rounded-full border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {canEdit ? (ts ? "View / submit" : "Open") : "Available later"}
            </button>

            {!canEdit && (
              <p className="text-[10px] text-slate-500 text-right">
                Opens: {formatOpenFromLabel(openFrom)}
              </p>
            )}

            {canEdit && !ts && (
              <p className="text-[10px] text-amber-700 text-right">
                Timesheet not loaded yet (check again shortly).
              </p>
            )}
          </div>
        </div>

        {isActive && (
          <form
            onSubmit={handleSubmit}
            className="mt-2 border-t border-slate-200 pt-3 space-y-3 text-xs md:text-sm"
          >
            {String(ts?.status || "").toLowerCase() === "approved" && (
              <div className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-2 rounded-lg">
                This timesheet is approved and read-only.
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <label className="block mb-1 font-semibold">Break taken (minutes)</label>
                <input
                  type="number"
                  min="0"
                  className="uh-input"
                  value={form.breakMinutes}
                  onChange={(e) => handleInputChange("breakMinutes", e.target.value)}
                  placeholder="e.g. 30"
                  disabled={isApprovedLocked}
                />
              </div>

              <div>
                <label className="block mb-1 font-semibold">
                  {getApproverLabel(ts) ? "Approved by *" : "Client name *"}
                </label>
                <input
                  type="text"
                  className="uh-input"
                  value={form.clientName}
                  onChange={(e) => handleInputChange("clientName", e.target.value)}
                  disabled={isApprovedLocked || !!getApproverLabel(ts)}
                />
                {getApproverLabel(ts) && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Showing the staff/admin who approved this timesheet.
                  </p>
                )}
              </div>

              <div>
                <label className="block mb-1 font-semibold">Client role *</label>
                <input
                  type="text"
                  className="uh-input"
                  value={form.clientRole}
                  onChange={(e) => handleInputChange("clientRole", e.target.value)}
                  placeholder="e.g. Ward Manager"
                  disabled={isApprovedLocked}
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <label className="block mb-1 font-semibold">Client sign date *</label>
                <input
                  type="date"
                  className="uh-input"
                  value={form.clientSignedDate}
                  onChange={(e) => handleInputChange("clientSignedDate", e.target.value)}
                  disabled={isApprovedLocked}
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
                  onChange={(e) => handleInputChange("staffSignedName", e.target.value)}
                  placeholder="Your full name"
                  disabled={isApprovedLocked}
                />
              </div>
            </div>

            {/* Client signature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block font-semibold">Client signature (optional)</label>
                <button
                  type="button"
                  onClick={clearSignature}
                  disabled={isApprovedLocked}
                  className="text-[11px] px-3 py-1 rounded-full border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Clear signature
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2 overflow-x-auto">
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={160}
                  className="block rounded-lg border border-slate-200 touch-none"
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Ask the client to sign in the box (finger/mouse). This will be saved with the timesheet submission.
              </p>

              {clientSigDataUrl ? (
                <p className="text-[11px] text-emerald-700">Signature captured.</p>
              ) : (
                <p className="text-[11px] text-slate-500">No signature captured yet.</p>
              )}

              {ts?.clientSignatureUrl && (
                <p className="text-[11px]">
                  <a
                    href={ts.clientSignatureUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-700 hover:underline"
                  >
                    View saved client signature
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="inline-flex items-start gap-2 text-[11px] md:text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.staffDeclaration}
                  onChange={(e) => handleInputChange("staffDeclaration", e.target.checked)}
                  className="mt-0.5"
                  disabled={isApprovedLocked}
                />
                <span>
                  I confirm that the hours recorded on this timesheet are true and correct,
                  that the client representative has approved the shift, and that I have complied with
                  Unity Healthcare Staffing&apos;s policies and procedures.
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
                  const file = e.target.files?.[0] || null;
                  setPaperFile(file);
                  handleInputChange("paperFileName", file ? file.name : "");
                }}
                className="text-[11px] md:text-xs"
                disabled={isApprovedLocked}
              />

              {form.paperFileName && (
                <p className="text-[11px] text-slate-500">
                  Selected file: {form.paperFileName}
                </p>
              )}

              {ts?.paperFileUrl && (
                <p className="text-[11px]">
                  <a
                    href={ts.paperFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-700 hover:underline"
                  >
                    View uploaded file
                  </a>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="submit"
                disabled={saving || !canEdit || isApprovedLocked}
                className="px-4 py-1.5 rounded-full bg-cyan-700 text-white text-xs md:text-sm font-semibold hover:bg-cyan-800 disabled:opacity-60"
              >
                {saving ? "Submitting…" : "Submit timesheet"}
              </button>
              <button
                type="button"
                onClick={closeTimesheetForm}
                className="px-4 py-1.5 rounded-full border border-slate-300 bg-slate-50 text-xs md:text-sm text-slate-700 hover:bg-slate-100"
              >
                {focusMode ? "Back to list" : "Cancel"}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  if (!currentUser) {
    return (
      <div className="text-sm text-slate-600">
        Please sign in to view your timesheets.
      </div>
    );
  }

  const focusShift =
    focusMode && activeShiftId ? shifts.find((s) => s.id === activeShiftId) : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base md:text-lg font-semibold text-slate-900">
          Timesheets
        </h2>
        <p className="text-xs md:text-sm text-slate-600">
          Timesheets are generated from your shifts and become available 30 minutes before the end of each shift.
        </p>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {!error && info && (
        <div className="text-sm bg-rose-50 text-rose-700 border border-rose-200 px-3 py-2 rounded-lg">
          {info}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Loading timesheets…</div>
      ) : !shifts.length ? (
        <div className="text-sm text-slate-600">
          {error
              ? "Timesheet shifts could not be displayed."
              : "You don&apos;t have any eligible shifts yet. Your timesheets will appear here once you have booked and worked shifts."}
        </div>
      ) : (
        <div className="space-y-3">
          {/* ✅ Focus mode (only one timesheet visible) */}
          {focusShift ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-600">
                  You are viewing/submitting one timesheet.
                </p>
                <button
                  type="button"
                  onClick={closeTimesheetForm}
                  className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  Back to list
                </button>
              </div>
              {renderShiftCard(focusShift)}
            </>
          ) : (
            <>
              {/* ✅ Group 1: Needs action */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Needs action
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {grouped.needsAction.length}
                  </span>
                </div>
                {grouped.needsAction.length ? (
                  <div className="space-y-3">
                    {grouped.needsAction.map((s) => renderShiftCard(s))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    No timesheets need action right now.
                  </div>
                )}
              </div>

              {/* ✅ Group 2: Submitted / Approved */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Submitted / Approved
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {grouped.submittedApproved.length}
                  </span>
                </div>
                {grouped.submittedApproved.length ? (
                  <div className="space-y-3">
                    {grouped.submittedApproved.map((s) => renderShiftCard(s))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    No submitted or approved timesheets yet.
                  </div>
                )}
              </div>

              {/* ✅ Group 3: Available later */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Available later
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {grouped.availableLater.length}
                  </span>
                </div>
                {grouped.availableLater.length ? (
                  <div className="space-y-3">
                    {grouped.availableLater.map((s) => renderShiftCard(s))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    No locked timesheets.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

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
