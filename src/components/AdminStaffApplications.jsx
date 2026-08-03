// src/components/AdminStaffApplications.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  where,
  limit,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "rejected", label: "Rejected" },
  { value: "onboarded", label: "Onboarded" },
];

function formatDate(ts) {
  try {
    if (!ts) return "—";
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

function Badge({ value }) {
  const cls =
    value === "new"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : value === "shortlisted"
        ? "bg-cyan-50 text-cyan-800 border-cyan-200"
        : value === "onboarded"
          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
          : "bg-rose-50 text-rose-800 border-rose-200";

  const label =
    STATUS_OPTIONS.find((s) => s.value === value)?.label || String(value || "—");

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function DocLink({ label, url }) {
  if (!url) {
    return (
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-xs text-slate-700">{label}</span>
        <span className="text-[11px] text-slate-400">Not provided</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-slate-700">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] font-semibold text-cyan-700 hover:text-cyan-900 underline"
      >
        Open / download
      </a>
    </div>
  );
}

function displayApplicantName(x) {
  const surname = x?.surname?.trim();
  const otherNames = x?.otherNames?.trim();

  if (surname || otherNames) {
    return `${otherNames || ""} ${surname || ""}`.trim() || "—";
  }
  return x?.fullName || "—";
}

function renderAddress(addr) {
  if (!addr || typeof addr !== "object") return "—";

  const parts = [
    addr.addressLine1,
    addr.addressLine2,
    addr.cityTown,
    addr.county,
    addr.postcode,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "—";
}

function EmploymentHistory({ items }) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    return <div className="text-xs text-slate-500">No employment history provided.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const employer = r?.employerName || "—";
        const role = r?.jobTitle || "—";
        const start = r?.startDate || "—";
        const end = r?.isCurrent ? "Present" : r?.endDate || "—";
        const duties = r?.mainDuties || "";

        return (
          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">{employer}</div>
              <div className="text-[11px] text-slate-500">
                {start} → {end}
              </div>
            </div>

            <div className="mt-1 text-xs text-slate-700">
              <span className="font-semibold">Job title:</span> {role}
            </div>

            {duties && (
              <div className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">
                <span className="font-semibold text-slate-700">Main duties:</span>{" "}
                {duties}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ✅ render up to 2 referees (array) with legacy fallback
function getReferees(app) {
  const fromArray = Array.isArray(app?.referees) ? app.referees : [];
  const cleanArray = fromArray
    .map((r) => ({
      name: r?.name || "",
      email: r?.email || "",
      phone: r?.phone || "",
      relationship: r?.relationship || "",
    }))
    .filter((r) => r.name || r.email || r.phone || r.relationship);

  if (cleanArray.length) return cleanArray.slice(0, 2);

  // Legacy fallback (Referee 1)
  const legacy = {
    name: app?.refereeName || "",
    email: app?.refereeEmail || "",
    phone: app?.refereePhone || "",
    relationship: app?.refereeRelationship || "",
  };

  const hasLegacy = legacy.name || legacy.email || legacy.phone || legacy.relationship;
  return hasLegacy ? [legacy] : [];
}

function RefereeBlock({ title, r }) {
  if (!r) return null;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
        {title}
      </p>
      <div className="mt-2 space-y-1.5 text-xs text-slate-700">
        <div>
          <span className="font-semibold">Name:</span> {r.name || "—"}
        </div>
        <div>
          <span className="font-semibold">Email:</span> {r.email || "—"}
        </div>
        <div>
          <span className="font-semibold">Phone:</span> {r.phone || "—"}
        </div>
        <div>
          <span className="font-semibold">Relationship:</span> {r.relationship || "—"}
        </div>
      </div>
    </div>
  );
}

// ✅ generate unique 4-digit publicId for staff users
async function generateUniquePublicIdForUser() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const id = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
    const qUsers = query(collection(db, "users"), where("publicId", "==", id), limit(1));
    const snap = await getDocs(qUsers);
    if (snap.empty) return id;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function AdminStaffApplications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // UI state
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  // Edit state for selected
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const [editStatus, setEditStatus] = useState("new");
  const [adminNotes, setAdminNotes] = useState("");

  useEffect(() => {
    const applicationsRef = collection(db, "staffApplications");

    const unsub = onSnapshot(
      applicationsRef,
      (snap) => {
        const toMillis = (value) => {
          if (!value) return 0;

          if (typeof value.toMillis === "function") {
            return value.toMillis();
          }

          if (typeof value.toDate === "function") {
            return value.toDate().getTime();
          }

          if (typeof value.seconds === "number") {
            return value.seconds * 1000;
          }

          const parsed = new Date(value).getTime();
          return Number.isFinite(parsed) ? parsed : 0;
        };

        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const aTime = toMillis(
              a.createdAt ||
                a.submittedAt ||
                a.updatedAt ||
                a.reviewedAt
            );

            const bTime = toMillis(
              b.createdAt ||
                b.submittedAt ||
                b.updatedAt ||
                b.reviewedAt
            );

            return bTime - aTime;
          });

        setItems(rows);
        setLoadError("");
        setLoading(false);
      },
      (err) => {
        console.error("AdminStaffApplications snapshot error:", err);
        setLoadError(
          "Staff applications could not be loaded. Please refresh or check administrator access."
        );
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // When selecting a row, load editable fields
  useEffect(() => {
    setSaveMsg("");
    setSaveErr("");
    setSaving(false);

    if (!selected) return;
    setEditStatus(selected.status || "new");
    setAdminNotes(selected.adminNotes || "");
  }, [selected]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();

    return items.filter((x) => {
      const matchesStatus =
        statusFilter === "all" ? true : (x.status || "new") === statusFilter;

      const refs = getReferees(x);
      const refHay = refs
        .map((r) => [r.name, r.email, r.phone, r.relationship].filter(Boolean).join(" "))
        .join(" ");

      const hay = [
        displayApplicantName(x),
        x.surname,
        x.otherNames,
        x.fullName,
        x.email,
        x.phone,
        x.roleApplied,
        x.rightToWorkStatus,
        x.refereeName,
        x.refereeEmail,
        refHay,
        x.address?.addressLine1,
        x.address?.cityTown,
        x.address?.postcode,
        x.publicId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !s ? true : hay.includes(s);
      return matchesStatus && matchesSearch;
    });
  }, [items, statusFilter, search]);

  const counts = useMemo(() => {
    const c = { all: items.length, new: 0, shortlisted: 0, rejected: 0, onboarded: 0 };
    for (const it of items) {
      const st = it.status || "new";
      if (c[st] !== undefined) c[st] += 1;
    }
    return c;
  }, [items]);

  const closeModal = () => setSelected(null);

  const saveDecision = async () => {
    if (!selected) return;
    setSaveMsg("");
    setSaveErr("");

    try {
      setSaving(true);

      const payload = {
        status: editStatus,
        adminNotes: adminNotes?.trim() || "",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.email || "admin",
      };

      await updateDoc(doc(db, "staffApplications", selected.id), payload);
      setSaveMsg("Saved.");
    } catch (e) {
      console.error("Failed to update application:", e);
      setSaveErr("Could not save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const activateStaffAndOnboard = async () => {
    if (!selected) return;

    const uid = selected.uid;
    if (!uid) {
      setSaveErr("This application is missing uid. Cannot activate user.");
      return;
    }

    setSaveMsg("");
    setSaveErr("");

    try {
      setSaving(true);

      const publicId = selected.publicId || (await generateUniquePublicIdForUser());
      const reviewedBy = auth.currentUser?.email || "admin";
      const otherNames = String(
        selected.otherNames || ""
      ).trim();

      const surname = String(
        selected.surname || ""
      ).trim();

      const fullName = [
        otherNames,
        surname,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const firstName =
        otherNames
          .split(/\s+/)
          .filter(Boolean)[0] ||
        fullName
          .split(/\s+/)
          .filter(Boolean)[0] ||
        "";
      await updateDoc(doc(db, "staffApplications", selected.id), {
        status: "onboarded",
        firstName: firstName || null,
        otherNames: otherNames || null,
        surname: surname || null,
        fullName: fullName || null,
        publicId,
        onboardedAt: serverTimestamp(),
        onboardedBy: reviewedBy,
        reviewedAt: serverTimestamp(),
        reviewedBy,
        adminNotes: adminNotes?.trim() || "",
      });

      await updateDoc(doc(db, "users", uid), {
        publicId,
        firstName: firstName || null,
        otherNames: otherNames || null,
        surname: surname || null,
        fullName: fullName || null,
        name: fullName || null,
        displayName: fullName || null,
        isActive: true,
        status: "active",
        onboardingCompleted: true,
        isStaff: true,
        role: "staff",
        staffRole: selected.roleApplied || null,
        activatedAt: serverTimestamp(),
        activatedBy: reviewedBy,
      });

      setSaveMsg(`Staff activated. Public ID: ${publicId}`);

      setSelected((prev) => (prev ? { ...prev, status: "onboarded", publicId } : prev));
      setEditStatus("onboarded");
    } catch (e) {
      console.error("Activate staff failed:", e);
      setSaveErr(
        "Could not activate staff. Check Firestore rules allow admin to update users/{uid}."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          {loadError}
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Staff Applications</h3>
          <p className="text-xs text-slate-500">
            Review staff submissions, documents, and update status. You can also activate staff
            accounts.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs">
            <span className="text-slate-500">Total: </span>
            <span className="font-semibold text-slate-900">{counts.all}</span>
          </div>
          <div className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs">
            <span className="text-slate-500">New: </span>
            <span className="font-semibold text-slate-900">{counts.new}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, role, address, referees, public ID…"
            className="uh-input"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="uh-input bg-white"
          >
            <option value="all">All ({counts.all})</option>
            <option value="new">New ({counts.new})</option>
            <option value="shortlisted">Shortlisted ({counts.shortlisted})</option>
            <option value="rejected">Rejected ({counts.rejected})</option>
            <option value="onboarded">Onboarded ({counts.onboarded})</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-600">Loading applications…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No applications match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Applicant</th>
                  <th className="px-4 py-3">Public ID</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Experience</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((x) => (
                  <tr key={x.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{displayApplicantName(x)}</div>
                      <div className="text-xs text-slate-500">{x.email || "—"}</div>
                      {x.phone && <div className="text-xs text-slate-500">{x.phone}</div>}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-slate-900">{x.publicId || "—"}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="text-slate-900">{x.roleApplied || "—"}</div>
                      {x.preferredLocations && (
                        <div className="text-xs text-slate-500">📍 {x.preferredLocations}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-900">
                        3+ months:{" "}
                        <span className="font-semibold">
                          {x.has3MonthsExperience === "yes"
                            ? "Yes"
                            : x.has3MonthsExperience === "no"
                              ? "No"
                              : "—"}
                        </span>
                      </div>
                      {x.totalExperienceMonths && (
                        <div className="text-xs text-slate-500">
                          Total: {x.totalExperienceMonths} months
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={x.status || "new"} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{formatDate(x.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelected(x)}
                        className="px-3 py-1.5 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40" onClick={closeModal} />

          {/* ✅ change: align center always + allow internal scrolling */}
          <div className="absolute inset-0 flex items-center justify-center p-3">
            {/* ✅ change: constrain height to viewport, keep header/footer fixed, body scrolls */}
            <div className="w-full md:max-w-5xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
              {/* Modal header (fixed) */}
              <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold text-slate-900 truncate">
                      {displayApplicantName(selected)}
                    </h4>
                    <Badge value={selected.status || "new"} />
                    {selected.publicId && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                        ID: {selected.publicId}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{selected.email || "—"}</p>
                  <p className="text-[11px] text-slate-500">
                    Submitted: {formatDate(selected.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              {/* ✅ Modal body (scrollable) */}
              <div className="p-4 grid gap-4 md:grid-cols-2 overflow-y-auto flex-1">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Personal
                    </p>
                    <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                      <div>
                        <span className="font-semibold">Surname:</span> {selected.surname || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Other names:</span>{" "}
                        {selected.otherNames || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Phone:</span> {selected.phone || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Role:</span> {selected.roleApplied || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Right to work:</span>{" "}
                        {selected.rightToWorkStatus || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">NI number:</span>{" "}
                        {selected.niNumber || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Heard about us:</span>{" "}
                        {selected.heardAboutUs || "—"}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Address
                    </p>
                    <div className="mt-2 text-xs text-slate-700">{renderAddress(selected.address)}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Experience & Availability
                    </p>
                    <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                      <div>
                        <span className="font-semibold">3+ months:</span>{" "}
                        {selected.has3MonthsExperience || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Total months:</span>{" "}
                        {selected.totalExperienceMonths || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Current role:</span>{" "}
                        {selected.currentRole || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Preferred locations:</span>{" "}
                        {selected.preferredLocations || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Can work nights:</span>{" "}
                        {selected.canWorkNights || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Can drive:</span> {selected.canDrive || "—"}
                      </div>
                      {selected.experienceSummary && (
                        <div className="pt-2">
                          <div className="font-semibold text-slate-700">Summary</div>
                          <div className="text-xs text-slate-600 whitespace-pre-wrap">
                            {selected.experienceSummary}
                          </div>
                        </div>
                      )}
                      {selected.availability && (
                        <div className="pt-2">
                          <div className="font-semibold text-slate-700">Availability</div>
                          <div className="text-xs text-slate-600 whitespace-pre-wrap">
                            {selected.availability}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Employment history
                    </p>
                    <div className="mt-2">
                      <EmploymentHistory items={selected.employmentHistory} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(() => {
                      const refs = getReferees(selected);
                      if (!refs.length) {
                        return (
                          <div className="rounded-xl border border-slate-200 p-3">
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                              Referees
                            </p>
                            <div className="mt-2 text-xs text-slate-500">
                              No referee details provided.
                            </div>
                          </div>
                        );
                      }

                      return (
                        <>
                          <RefereeBlock title="Referee 1" r={refs[0]} />
                          <RefereeBlock title="Referee 2" r={refs[1]} />
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Documents
                    </p>
                    <div className="mt-2 divide-y divide-slate-100">
                      <DocLink label="CV" url={selected.documents?.cvUrl} />
                      <DocLink label="Right to Work" url={selected.documents?.rightToWorkUrl} />
                      <DocLink label="Share code document" url={selected.documents?.shareCodeUrl} />
                      <DocLink label="DBS" url={selected.documents?.dbsUrl} />
                      <DocLink label="Training" url={selected.documents?.trainingUrl} />
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      If a document link doesn’t open, confirm Storage rules allow admin reads.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Decision status
                      </label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="uh-input bg-white mt-1"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Internal admin notes
                      </label>
                      <textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        className="uh-input min-h-[110px] mt-1"
                        placeholder="Add notes for your team (not visible to applicants)."
                      />
                    </div>

                    {saveMsg && (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                        {saveMsg}
                      </div>
                    )}
                    {saveErr && (
                      <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg">
                        {saveErr}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="px-4 py-2 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        onClick={saveDecision}
                        disabled={saving}
                        className="px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>

                      <button
                        type="button"
                        onClick={activateStaffAndOnboard}
                        disabled={saving}
                        className="px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                        title="Sets application to onboarded and activates user account"
                      >
                        {saving ? "Working…" : "Activate staff + Onboard"}
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      Admin actions update: <span className="font-semibold">staffApplications</span>{" "}
                      and <span className="font-semibold">users/{`{uid}`}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal footer (fixed) */}
              <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <span className="text-[11px] text-slate-500">
                  Application ID: <span className="font-mono">{selected.id}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  Done
                </button>
              </div>
            </div>
          </div>

          <style>{`
            .uh-input {
              width: 100%;
              padding: 10px 12px;
              border: 1px solid #cbd5e1;
              border-radius: 12px;
              outline: none;
              font-size: 0.9rem;
              background: white;
            }
            .uh-input:focus {
              border-color: #0e7490;
              box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.25);
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
