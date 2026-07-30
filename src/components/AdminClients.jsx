// src/components/AdminClients.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  updateDoc,
  doc,
  setDoc,
  where,
  limit,
  serverTimestamp,
  documentId,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  ADMIN_CLIENT_READ_MODES,
  mergeAdminClientRows,
  resolveAdminClientReadPlan,
} from "../utils/adminClientQueryPlan";
import { canAccessClient } from "../utils/adminAccess";
import {
  Users,
  FileSearch,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  Download,
  Printer,
  Eye,
  Save,
  X,
} from "lucide-react";

/**
 * ✅ 4-digit code helpers (collision-safe)
 * NOTE: 4 digits = 10,000 possibilities, collisions are possible.
 * We retry and ensure uniqueness in Firestore.
 */
const random4 = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

async function generateUnique4DigitCodeForClient() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = random4();
    const clientsRef = collection(db, "clients");
    const q = query(clientsRef, where("clientCode", "==", code), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return code;
  }
  throw new Error("Could not generate a unique 4-digit client code. Try again.");
}

function normalize4DigitCode(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.padStart(4, "0");
}

// ✅ CSV helpers
function csvEscape(value) {
  const s = String(value ?? "");
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ---------- Rates helpers ----------
const RATE_ROLES = [
  "Healthcare Assistants (HCA)",
  "Support Workers",
  "Registered Nurses (RGN)",
  "Mental Health Nurses (RMN)",
  "Specialist Support",
  "Other",
];

function toNumberOrNull(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatRate(v) {
  const n = toNumberOrNull(v);
  if (n == null) return "—";
  const shown = Math.round(n * 100) / 100;
  return `£${shown}/hr`;
}

function getProposedRates(client) {
  const pr =
    client?.proposedRates ||
    client?.proposedRatesByRole ||
    client?.rates?.proposed ||
    client?.ratesProposed ||
    null;

  const out = [];
  if (pr && typeof pr === "object") {
    for (const key of Object.keys(pr)) out.push([key, pr[key]]);
  }

  if (!out.length && Array.isArray(client?.servicesNeeded) && client.servicesNeeded.length) {
    for (const s of client.servicesNeeded) out.push([s, null]);
  }

  const order = new Map(RATE_ROLES.map((r, i) => [r, i]));
  out.sort((a, b) => {
    const ai = order.has(a[0]) ? order.get(a[0]) : 999;
    const bi = order.has(b[0]) ? order.get(b[0]) : 999;
    if (ai !== bi) return ai - bi;
    return String(a[0]).localeCompare(String(b[0]));
  });

  const seen = new Set();
  const cleaned = [];
  for (const [role, rate] of out) {
    const k = String(role || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    cleaned.push([k, rate]);
  }
  return cleaned;
}

function getRatesDecision(client) {
  const s =
    String(
      client?.ratesDecisionStatus ||
        client?.proposedRatesStatus ||
        client?.ratesStatus ||
        ""
    )
      .trim()
      .toLowerCase();

  if (s === "approved") return "approved";
  if (s === "needs_review" || s === "needs review" || s === "review") return "needs_review";
  if (s === "rejected") return "rejected";
  return "pending_review";
}

function RatesBadge({ value }) {
  const v = String(value || "").toLowerCase();
  const cls =
    v === "approved"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : v === "needs_review"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : v === "rejected"
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  const label =
    v === "approved"
      ? "Approved"
      : v === "needs_review"
      ? "Needs review"
      : v === "rejected"
      ? "Rejected"
      : "Pending review";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function DocLink({ url }) {
  if (!url) return <span className="text-[11px] text-slate-400">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] text-cyan-700 hover:text-cyan-900 underline"
    >
      Open / download
    </a>
  );
}

// ---------- Printing ----------
function openPrintWindow(title, html) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=980,height=720");
  if (!w) {
    alert("Popup blocked. Please allow popups to print.");
    return;
  }

  w.document.open();
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#0f172a}
  h1{font-size:18px;margin:0 0 10px}
  h2{font-size:12px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#475569}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{border:1px solid #e2e8f0;border-radius:12px;padding:12px}
  .row{display:flex;gap:8px;font-size:12px;line-height:1.45}
  .k{min-width:140px;color:#475569}
  .v{flex:1}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}
  th{color:#475569;font-weight:600;background:#f8fafc}
  .muted{color:#64748b}
  @media print{
    body{margin:0}
    .card{break-inside:avoid}
  }
</style>
</head>
<body>
${html}
<script>
  window.focus();
  setTimeout(()=>{ window.print(); }, 200);
</script>
</body>
</html>`);
  w.document.close();
}

export default function AdminClients({ currentUser, adminAccess }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Sort state
  const [sortBy, setSortBy] = useState("createdAt"); // "client" | "status" | "createdAt" | "clientCode"
  const [sortDirection, setSortDirection] = useState("desc"); // "asc" | "desc"

  // Review modal state
  const [selected, setSelected] = useState(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewMsg, setReviewMsg] = useState("");
  const [reviewErr, setReviewErr] = useState("");
  const [ratesDecision, setRatesDecision] = useState("pending_review");
  const [adminNotes, setAdminNotes] = useState("");

  const clientEditScope =
    adminAccess
      ?.permissions
      ?.clients
      ?.edit ||
    "none";

  const canEditClientRecord =
    (clientId) =>
      canAccessClient(
        adminAccess,
        clientId,
        clientEditScope
      );

  const clientEditDeniedMessage =
    "You do not have permission to edit this client.";

  const loadClients = async () => {
    setLoading(true);
    setError("");

    try {
      const readPlan =
        resolveAdminClientReadPlan(
          adminAccess
        );

      if (
        readPlan.mode ===
          ADMIN_CLIENT_READ_MODES.EMPTY
      ) {
        setClients([]);
        return;
      }

      const refCol = collection(db, "clients");

      if (
        readPlan.mode ===
          ADMIN_CLIENT_READ_MODES.ALL
      ) {
        const allClientsQuery = query(
          refCol,
          orderBy("createdAt", "desc")
        );

        const snap =
          await getDocs(
            allClientsQuery
          );

        const data = snap.docs.map(
          (clientDocument) => ({
            id:
              clientDocument.id,

            ...clientDocument.data(),
          })
        );

        setClients(data);
        return;
      }

      if (
        readPlan.mode !==
          ADMIN_CLIENT_READ_MODES.ASSIGNED
      ) {
        setClients([]);
        return;
      }

      const snapshots =
        await Promise.all(
          readPlan.chunks.map(
            (clientIds) => {
              const assignedClientsQuery =
                query(
                  refCol,
                  where(
                    documentId(),
                    "in",
                    clientIds
                  )
                );

              return getDocs(
                assignedClientsQuery
              );
            }
          )
        );

      const data = mergeAdminClientRows(
        snapshots.map(
          (snapshot) =>
            snapshot.docs.map(
              (clientDocument) => ({
                id:
                  clientDocument.id,

                ...clientDocument.data(),
              })
            )
        )
      );

      setClients(data);
    } catch (err) {
      console.error("Error loading clients:", err);
      setError("Could not load client records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [adminAccess]);

  // When opening a client, preload editable review fields
  useEffect(() => {
    setReviewMsg("");
    setReviewErr("");
    setReviewSaving(false);
    if (!selected) return;

    setRatesDecision(getRatesDecision(selected));
    setAdminNotes(
      selected?.ratesAdminNotes ||
        selected?.adminNotes ||
        selected?.internalNotes ||
        ""
    );
  }, [selected]);

  // ---------- Helpers ----------
  const safeText = (v) => (typeof v === "string" ? v.trim() : "");

  const getDisplayName = (c) =>
    c.organisationName ||
    c.tradingName ||
    c.contact?.name ||
    c.contactName ||
    c.email ||
    "Unnamed client";

  const getClientContactName = (c) =>
    c.contact?.name || c.contactName || c.primaryContactName || c.contactPerson || "";

  const getClientPhone = (c) =>
    c.contact?.phone ||
    c.contactPhone ||
    c.phone ||
    c.telephone ||
    c.mobile ||
    c.primaryPhone ||
    "";

  const formatAddress = (addr) => {
    if (!addr) return "";
    if (typeof addr === "string") return addr;

    if (typeof addr === "object") {
      const parts = [
        safeText(addr.addressLine1),
        safeText(addr.addressLine2),
        safeText(addr.cityTown),
        safeText(addr.county),
        safeText(addr.postcode),
      ].filter(Boolean);

      return parts.join(", ");
    }
    return "";
  };

  const getDisplayPostcode = (c) => {
    const pcObj =
      (c.organisationAddress && c.organisationAddress.postcode) ||
      (c.invoiceAddress && c.invoiceAddress.postcode) ||
      "";
    return (
      safeText(pcObj) ||
      safeText(c.organisationPostcode) ||
      safeText(c.postcode) ||
      ""
    );
  };

  const getStatusBadge = (c) => {
    const s = (c.status || "").toLowerCase();
    if (c.isActive || s === "active") {
      return {
        label: "Active",
        className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };
    }
    if (s === "pending" || s === "new" || s === "submitted") {
      return {
        label: "Pending",
        className: "bg-amber-50 text-amber-700 border border-amber-200",
      };
    }
    return {
      label: "Inactive",
      className: "bg-slate-50 text-slate-700 border border-slate-200",
    };
  };

  // ✅ Get 4-digit ID display
  const getClientCode = (c) => normalize4DigitCode(c.clientCode || c.publicId || "");

  /**
   * ✅ Ensure a stable 4-digit client ID code on clients/{uid}
   * and mirror to users/{uid}.
   * Called only when activating if missing (non-breaking).
   */
  const ensureClientCode = async (uid) => {
    if (
      !canEditClientRecord(
        uid
      )
    ) {
      throw new Error(
        clientEditDeniedMessage
      );
    }
    const clientRef = doc(db, "clients", uid);
    const existing = clients.find((x) => x.id === uid);
    const existingCode = existing?.clientCode || existing?.publicId;

    if (existingCode && String(existingCode).trim()) {
      return normalize4DigitCode(existingCode);
    }

    const code = await generateUnique4DigitCodeForClient();

    // reserve on client doc
    await setDoc(clientRef, { clientCode: code }, { merge: true });

    // mirror into users doc (helps elsewhere)
    await setDoc(doc(db, "users", uid), { clientCode: code, role: "client" }, { merge: true });

    return code;
  };

  const toggleActive = async (client) => {
    if (!currentUser) return;

    if (
      !canEditClientRecord(
        client?.id
      )
    ) {
      alert(
        clientEditDeniedMessage
      );
      return;
    }

    const willActivate = !client.isActive;
    const confirmMsg = willActivate
      ? `Activate client "${getDisplayName(client)}"?`
      : `Deactivate this client? They will no longer be able to post shifts.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSavingId(client.id);

      // ✅ If activating and code missing, create it first (safe + minimal)
      let clientCode = getClientCode(client);
      if (willActivate && !clientCode) {
        clientCode = await ensureClientCode(client.id);
      }

      const clientRef = doc(db, "clients", client.id);

      await updateDoc(clientRef, {
        isActive: willActivate,
        activatedAt: willActivate ? serverTimestamp() : null,
        activatedBy: willActivate ? (currentUser.uid || currentUser.email || "admin") : null,
        status: willActivate ? "active" : "inactive",
        ...(willActivate && clientCode ? { clientCode } : {}),
      });

      await loadClients();
    } catch (err) {
      console.error("Error updating client status:", err);
      alert("Could not change client status.");
    } finally {
      setSavingId(null);
    }
  };

  // Filter + sort
  const filteredAndSorted = useMemo(() => {
    let list = [...clients];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter((c) => {
        const name = getDisplayName(c).toLowerCase();
        const email = (c.email || "").toLowerCase();
        const type = (c.businessType || c.clientType || "").toLowerCase();
        const org = (c.organisationName || "").toLowerCase();
        const code = getClientCode(c).toLowerCase();
        const phone = String(getClientPhone(c) || "").toLowerCase();
        const contact = String(getClientContactName(c) || "").toLowerCase();

        return (
          name.includes(term) ||
          email.includes(term) ||
          type.includes(term) ||
          org.includes(term) ||
          code.includes(term) ||
          phone.includes(term) ||
          contact.includes(term)
        );
      });
    }

    if (statusFilter !== "all") {
      list = list.filter((c) => {
        const s = (c.status || "").toLowerCase();
        if (statusFilter === "active") return c.isActive || s === "active";
        if (statusFilter === "pending")
          return s === "pending" || s === "new" || s === "submitted";
        if (statusFilter === "inactive") return !c.isActive && s === "inactive";
        return true;
      });
    }

    list.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortBy === "client") {
        aVal = getDisplayName(a).toLowerCase();
        bVal = getDisplayName(b).toLowerCase();
      } else if (sortBy === "status") {
        aVal = (a.status || "").toLowerCase();
        bVal = (b.status || "").toLowerCase();
      } else if (sortBy === "clientCode") {
        aVal = getClientCode(a) || "9999";
        bVal = getClientCode(b) || "9999";
      } else {
        const aDate = a.createdAt?.toDate?.() || null;
        const bDate = b.createdAt?.toDate?.() || null;
        aVal = aDate ? aDate.getTime() : 0;
        bVal = bDate ? bDate.getTime() : 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [clients, searchTerm, statusFilter, sortBy, sortDirection]);

  // ✅ CSV export (exports what you see: filtered + sorted)
  // NOTE: Removed "docs list" + removed "rates dropdown list" from table view already;
  // export still includes a rates summary, which is useful for reporting.
  const exportCSV = () => {
    const header = [
      "Client",
      "Client ID",
      "Contact Name",
      "Phone",
      "Email",
      "Type",
      "Postcode",
      "Rates Decision",
      "Proposed Rates (summary)",
      "Status",
      "Created",
      "Activated",
      "UID",
    ];

    const rows = filteredAndSorted.map((c) => {
      const createdDate = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString("en-GB") : "";
      const activatedDate = c.activatedAt?.toDate ? c.activatedAt.toDate().toLocaleDateString("en-GB") : "";

      const pr = getProposedRates(c)
        .map(([role, rate]) => `${role}: ${formatRate(rate)}`)
        .join(" | ");

      return [
        getDisplayName(c),
        getClientCode(c),
        getClientContactName(c),
        getClientPhone(c),
        c.email || "",
        c.businessType || c.clientType || "",
        getDisplayPostcode(c),
        getRatesDecision(c),
        pr,
        (c.isActive || String(c.status || "").toLowerCase() === "active") ? "Active" : (c.status || "Inactive"),
        createdDate,
        activatedDate,
        c.uid || c.id || "",
      ];
    });

    const filename = `unity-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(filename, [header, ...rows]);
  };

  const closeModal = () => setSelected(null);

  const saveRatesDecision = async () => {
    if (!selected) return;

    if (
      !canEditClientRecord(
        selected.id
      )
    ) {
      setReviewMsg("");
      setReviewErr(
        clientEditDeniedMessage
      );
      return;
    }
    setReviewMsg("");
    setReviewErr("");

    try {
      setReviewSaving(true);

      const payload = {
        ratesDecisionStatus: ratesDecision,
        ratesAdminNotes: adminNotes?.trim() || "",
        ratesReviewedAt: serverTimestamp(),
        ratesReviewedBy: currentUser?.email || currentUser?.uid || "admin",
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "clients", selected.id), payload);

      setReviewMsg("Saved.");
      await loadClients();
      setSelected((p) => (p ? { ...p, ...payload } : p));
    } catch (e) {
      console.error("Failed to update client rates decision:", e);
      setReviewErr("Could not save changes. Please try again.");
    } finally {
      setReviewSaving(false);
    }
  };

  const printClient = (client) => {
    const pr = getProposedRates(client);

    const docs = client?.documents || {};
    const docRows = [
      ["CQC certificate", docs.cqcUrl],
      ["Insurance certificate", docs.insuranceUrl],
      ["ID proof", docs.idProofUrl],
      ["Signed contract", docs.contractUrl],
      ["Other document", docs.otherUrl],
    ];

    const safe = (v) => (v == null ? "" : String(v));

    const title = `Client – ${safe(getDisplayName(client))}`;
    const html = `
      <h1>${title}</h1>
      <div class="muted" style="font-size:12px;margin-bottom:10px;">
        Generated: ${new Date().toLocaleString("en-GB")}
      </div>

      <div class="grid">
        <div class="card">
          <h2>Organisation</h2>
          <div class="row"><div class="k">Organisation name</div><div class="v">${safe(client.organisationName || "—")}</div></div>
          <div class="row"><div class="k">Trading name</div><div class="v">${safe(client.tradingName || "—")}</div></div>
          <div class="row"><div class="k">Business type</div><div class="v">${safe(client.businessType || client.clientType || "—")}</div></div>
          <div class="row"><div class="k">Company number</div><div class="v">${safe(client.companyNumber || "—")}</div></div>
          <div class="row"><div class="k">Website</div><div class="v">${safe(client.website || "—")}</div></div>
          <div class="row"><div class="k">Client ID</div><div class="v">${safe(getClientCode(client) || "—")}</div></div>
          <div class="row"><div class="k">UID</div><div class="v">${safe(client.uid || client.id || "—")}</div></div>
        </div>

        <div class="card">
          <h2>Contact</h2>
          <div class="row"><div class="k">Contact name</div><div class="v">${safe(client.contact?.name || client.contactName || "—")}</div></div>
          <div class="row"><div class="k">Role</div><div class="v">${safe(client.contact?.role || client.contactRole || "—")}</div></div>
          <div class="row"><div class="k">Contact email</div><div class="v">${safe(client.contact?.email || client.contactEmail || client.email || "—")}</div></div>
          <div class="row"><div class="k">Phone</div><div class="v">${safe(client.contact?.phone || getClientPhone(client) || "—")}</div></div>
          <div class="row"><div class="k">Account email</div><div class="v">${safe(client.email || "—")}</div></div>
        </div>

        <div class="card">
          <h2>Addresses</h2>
          <div class="row"><div class="k">Organisation</div><div class="v">${safe(formatAddress(client.organisationAddress) || client.organisationAddressText || "—")}</div></div>
          <div class="row"><div class="k">Invoice</div><div class="v">${safe(formatAddress(client.invoiceAddress) || "—")}</div></div>
          <div class="row"><div class="k">Postcode</div><div class="v">${safe(getDisplayPostcode(client) || "—")}</div></div>
        </div>

        <div class="card">
          <h2>Billing</h2>
          <div class="row"><div class="k">Invoice email</div><div class="v">${safe(client.invoiceEmail || "—")}</div></div>
          <div class="row"><div class="k">Billing cycle</div><div class="v">${safe(client.billingCycle || "—")}</div></div>
          <div class="row"><div class="k">PO number</div><div class="v">${safe(client.poNumber || "—")}</div></div>
          <div class="row"><div class="k">Approx shifts/week</div><div class="v">${safe(client.approxShiftsPerWeek || "—")}</div></div>
        </div>

        <div class="card" style="grid-column:1 / -1;">
          <h2>Services & proposed rates</h2>
          <div class="row"><div class="k">Services needed</div><div class="v">${safe((client.servicesNeeded || []).join(" | ") || "—")}</div></div>
          <div class="row"><div class="k">Rates decision</div><div class="v">${safe(getRatesDecision(client))}</div></div>
          <div class="row"><div class="k">Admin notes</div><div class="v">${safe(client.ratesAdminNotes || client.adminNotes || "—")}</div></div>

          <div style="margin-top:10px;">
            <table>
              <thead><tr><th>Role</th><th>Proposed rate</th></tr></thead>
              <tbody>
                ${
                  pr.length
                    ? pr
                        .map(
                          ([role, rate]) =>
                            `<tr><td>${safe(role)}</td><td>${safe(formatRate(rate))}</td></tr>`
                        )
                        .join("")
                    : `<tr><td colspan="2" class="muted">No proposed rates found.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="grid-column:1 / -1;">
          <h2>Documents</h2>
          <table>
            <thead><tr><th>Document</th><th>Link</th></tr></thead>
            <tbody>
              ${docRows
                .map(([label, url]) => {
                  const u = safe(url || "");
                  return `<tr><td>${safe(label)}</td><td>${u ? u : `<span class="muted">—</span>`}</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    openPrintWindow(title, html);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-9 w-9 rounded-2xl bg-cyan-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                Admin – Clients
              </h2>
              <p className="text-xs text-slate-500">
                Review onboarding details, verify documents and control client
                access.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCSV}
            disabled={loading || !filteredAndSorted.length}
            className="btn btn-outline !px-3 !py-1.5 !text-xs inline-flex items-center gap-2 disabled:opacity-60"
            title="Export current list to CSV"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>

          <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
            <span>
              Total clients:{" "}
              <span className="font-semibold text-slate-800">
                {clients.length}
              </span>
            </span>
            <span>
              Active:{" "}
              <span className="font-semibold text-emerald-700">
                {clients.filter((c) => c.isActive).length}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Filters row */}
      <div className="card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <FileSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by client name, email, type, phone, contact, or Client ID…"
              className="input pl-8 text-xs"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input !text-xs !py-1.5 !h-8 w-32"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
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
            <option value="client">Client</option>
            <option value="clientCode">Client ID</option>
            <option value="status">Status</option>
            <option value="createdAt">Created date</option>
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
          Loading clients…
        </div>
      ) : !filteredAndSorted.length ? (
        <div className="card text-sm text-slate-600">
          No clients found. Adjust your filters or search term.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-slate-700">Client</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Client ID</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Contact</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Email</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Phone</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Postcode</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Rates</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Rates status</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Status</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Created</th>
                <th className="px-3 py-2 font-semibold text-slate-700">Activated</th>
                {/* ✅ Removed Docs column completely */}
                <th className="px-3 py-2 font-semibold text-slate-700 text-right">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredAndSorted.map((client, idx) => {
                const statusBadge = getStatusBadge(client);
                const createdDate = client.createdAt?.toDate
                  ? client.createdAt.toDate().toLocaleDateString("en-GB")
                  : "—";
                const activatedDate = client.activatedAt?.toDate
                  ? client.activatedAt.toDate().toLocaleDateString("en-GB")
                  : "—";

                const clientCode = getClientCode(client);
                const contactName = getClientContactName(client);
                const phone = getClientPhone(client);

                const proposedRates = getProposedRates(client);
                const decision = getRatesDecision(client);

                return (
                  <tr
                    key={client.id}
                    className={`border-b border-slate-100 ${
                      idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-slate-900">
                        {getDisplayName(client)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        UID: {client.uid || client.id}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      {clientCode ? (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-800">
                          {clientCode}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                      {!clientCode && (
                        <div className="mt-1 text-[10px] text-slate-400">
                          Will generate on activation
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {contactName ? (
                        <div className="text-[11px]">
                          <span className="font-semibold text-slate-800">
                            {contactName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {client.businessType || client.clientType || "—"}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {client.email ? (
                        <a
                          href={`mailto:${client.email}`}
                          className="text-cyan-700 hover:text-cyan-900 underline"
                        >
                          {client.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {phone || "—"}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {getDisplayPostcode(client) || "—"}
                    </td>

                    {/* ✅ Rates column: simple count only (no dropdown list) */}
                    <td className="px-3 py-2 align-top text-slate-600">
                      {proposedRates.length ? (
                        <span className="text-[11px] text-slate-700">
                          {proposedRates.length} role{proposedRates.length > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <RatesBadge value={decision} />
                    </td>

                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {createdDate}
                    </td>

                    <td className="px-3 py-2 align-top text-slate-600">
                      {activatedDate}
                    </td>

                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(client)}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium bg-cyan-700 text-white hover:bg-cyan-800 border border-cyan-800"
                          title="Review full client details"
                        >
                          <Eye className="h-3 w-3" />
                          Review
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleActive(client)}
                          disabled={savingId === client.id || !canEditClientRecord(client.id)}
                          className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
                            client.isActive
                              ? "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
                              : "bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-700"
                          } disabled:opacity-60`}
                        >
                          {savingId === client.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : client.isActive ? (
                            <XCircle className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          <span>{client.isActive ? "Deactivate" : "Activate"}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ✅ Review Modal (scrollable + fits screen) */}
      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40" onClick={closeModal} />

          <div className="absolute inset-0 p-3 md:p-6 flex items-center justify-center">
            <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh]">
              {/* Header */}
              <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3 bg-white">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base md:text-lg font-semibold text-slate-900 truncate">
                      {getDisplayName(selected)}
                    </h4>
                    {getClientCode(selected) && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                        ID: {getClientCode(selected)}
                      </span>
                    )}
                    <RatesBadge value={getRatesDecision(selected)} />
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {selected.email || "—"} • UID: {selected.uid || selected.id}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => printClient(selected)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    title="Print client details"
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </button>

                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                    Close
                  </button>
                </div>
              </div>

              {/* Body (scrollable) */}
              <div className="p-4 overflow-y-auto">
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Left column */}
                  <div className="space-y-3 lg:col-span-1">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Organisation
                      </p>
                      <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                        <div>
                          <span className="font-semibold">Organisation name:</span>{" "}
                          {selected.organisationName || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Trading name:</span>{" "}
                          {selected.tradingName || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Business type:</span>{" "}
                          {selected.businessType || selected.clientType || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Company number:</span>{" "}
                          {selected.companyNumber || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Website:</span>{" "}
                          {selected.website || "—"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Contact
                      </p>
                      <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                        <div>
                          <span className="font-semibold">Contact name:</span>{" "}
                          {selected.contact?.name || selected.contactName || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Contact role:</span>{" "}
                          {selected.contact?.role || selected.contactRole || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Contact email:</span>{" "}
                          {selected.contact?.email || selected.contactEmail || selected.email || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Phone:</span>{" "}
                          {selected.contact?.phone || getClientPhone(selected) || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Account email:</span>{" "}
                          {selected.email || "—"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Billing
                      </p>
                      <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                        <div>
                          <span className="font-semibold">Invoice email:</span>{" "}
                          {selected.invoiceEmail || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Billing cycle:</span>{" "}
                          {selected.billingCycle || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">PO number:</span>{" "}
                          {selected.poNumber || "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Middle column */}
                  <div className="space-y-3 lg:col-span-1">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Services & rates
                      </p>

                      <div className="mt-2 text-xs text-slate-700 space-y-2">
                        <div>
                          <span className="font-semibold">Services needed:</span>{" "}
                          {(selected.servicesNeeded || []).length
                            ? (selected.servicesNeeded || []).join(" | ")
                            : "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Approx shifts per week:</span>{" "}
                          {selected.approxShiftsPerWeek || "—"}
                        </div>

                        <div className="pt-2">
                          <div className="font-semibold text-slate-700">
                            Proposed rates
                          </div>

                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-[420px] w-full text-xs">
                              <thead className="bg-slate-50 border border-slate-200">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                                    Role
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                                    Proposed rate
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="border border-slate-200">
                                {getProposedRates(selected).length ? (
                                  getProposedRates(selected).map(([role, rate]) => (
                                    <tr key={role} className="border-t border-slate-100">
                                      <td className="px-3 py-2 text-slate-700">
                                        {role}
                                      </td>
                                      <td className="px-3 py-2 font-mono text-slate-900">
                                        {formatRate(rate)}
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td className="px-3 py-2 text-slate-500" colSpan={2}>
                                      No proposed rates found.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          {selected.notes && (
                            <div className="mt-3">
                              <div className="font-semibold text-slate-700">Notes</div>
                              <div className="text-xs text-slate-600 whitespace-pre-wrap">
                                {selected.notes}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ✅ Documents section stays ONLY here (Review modal). */}
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Documents
                      </p>
                      <div className="mt-2 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-700">CQC certificate</span>
                          <DocLink url={selected?.documents?.cqcUrl} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-700">Insurance certificate</span>
                          <DocLink url={selected?.documents?.insuranceUrl} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-700">ID proof</span>
                          <DocLink url={selected?.documents?.idProofUrl} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-700">Signed contract</span>
                          <DocLink url={selected?.documents?.contractUrl} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-700">Other document</span>
                          <DocLink url={selected?.documents?.otherUrl} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="space-y-3 lg:col-span-1">
                    <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                          Rates decision
                        </label>
                        <select
                          value={ratesDecision}
                          onChange={(e) => setRatesDecision(e.target.value)}
                          disabled={
                            reviewSaving ||
                            !canEditClientRecord(selected.id)
                          }
                          className="uh-input bg-white mt-1"
                        >
                          <option value="pending_review">Pending review</option>
                          <option value="approved">Approved</option>
                          <option value="needs_review">Needs review (contact client)</option>
                          <option value="rejected">Rejected</option>
                        </select>

                        <p className="mt-2 text-[11px] text-slate-500">
                          Approving sets these proposed rates as <span className="font-semibold">binding</span> for the contract.
                          If not acceptable, mark as “Needs review” and contact the client.
                        </p>
                      </div>

                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                          Internal admin notes
                        </label>
                        <textarea
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          disabled={
                            reviewSaving ||
                            !canEditClientRecord(selected.id)
                          }
                          className="uh-input min-h-[140px] mt-1"
                          placeholder="Internal notes (not visible to client)."
                        />
                      </div>

                      {reviewMsg && (
                        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                          {reviewMsg}
                        </div>
                      )}
                      {reviewErr && (
                        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg">
                          {reviewErr}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={closeModal}
                          className="px-4 py-2 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50"
                        >
                          Close
                        </button>

                        <button
                          type="button"
                          onClick={saveRatesDecision}
                          disabled={
                            reviewSaving ||
                            !canEditClientRecord(selected.id)
                          }
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60"
                        >
                          {reviewSaving ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4" />
                              Save
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => printClient(selected)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800 disabled:opacity-60"
                        >
                          <Printer className="h-4 w-4" />
                          Print
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Account status
                      </p>
                      <div className="mt-2 text-xs text-slate-700 space-y-1.5">
                        <div>
                          <span className="font-semibold">Current status:</span>{" "}
                          {(selected.isActive || String(selected.status || "").toLowerCase() === "active")
                            ? "Active"
                            : (selected.status || "Inactive")}
                        </div>
                        <div>
                          <span className="font-semibold">Created:</span>{" "}
                          {selected.createdAt?.toDate
                            ? selected.createdAt.toDate().toLocaleString("en-GB")
                            : "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Activated:</span>{" "}
                          {selected.activatedAt?.toDate
                            ? selected.activatedAt.toDate().toLocaleString("en-GB")
                            : "—"}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => toggleActive(selected)}
                          disabled={savingId === selected.id || !canEditClientRecord(selected.id)}
                          className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                            selected.isActive
                              ? "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
                              : "bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-700"
                          } disabled:opacity-60`}
                        >
                          {savingId === selected.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : selected.isActive ? (
                            <XCircle className="h-4 w-4" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {selected.isActive ? "Deactivate client" : "Activate client"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  Client UID: <span className="font-mono">{selected.uid || selected.id}</span>
                </span>
                <button
                  type="button"
                  onClick={closeModal}
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
