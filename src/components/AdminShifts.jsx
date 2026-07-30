// src/components/AdminShifts.jsx
import { useEffect, useMemo, useState, Fragment } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  updateDoc,
  doc,
  Timestamp,
  getDoc,
  documentId,
  where,
} from "firebase/firestore";
import { db, functions } from "../firebaseConfig";
import { httpsCallable } from "firebase/functions";
import {
  CalendarDays,
  Loader2,
  ArrowUpDown,
  ListFilter,
  Users,
  Pencil,
  XCircle,
  CheckCircle2,
  Moon,
  Sun,
} from "lucide-react";

/** ✅ Rate helpers */
function hasRateValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== ""
  );
}

function readStaffRate(shift) {
  // Always prefer fields that explicitly represent staff pay.
  const explicitStaffRate =
    shift?.rates?.staff ??
    shift?.staffRate ??
    shift?.staffRatePerHour ??
    shift?.rateStaff ??
    shift?.rateStaffPerHour;

  if (hasRateValue(explicitStaffRate)) {
    return String(explicitStaffRate);
  }

  // hourlyRate was historically used for different purposes.
  // Do not treat it as staff pay when it merely duplicates
  // an explicitly stored client billing rate.
  const explicitClientRate =
    shift?.rates?.client ??
    shift?.clientRate ??
    shift?.billingRate ??
    shift?.clientHourlyRate ??
    shift?.clientRatePerHour ??
    shift?.rateClient ??
    shift?.rateClientPerHour;

  const legacyHourlyRate = shift?.hourlyRate;

  const hourlyRateMirrorsClientRate =
    hasRateValue(legacyHourlyRate) &&
    hasRateValue(explicitClientRate) &&
    Number(legacyHourlyRate) ===
    Number(explicitClientRate);

  if (hourlyRateMirrorsClientRate) {
    return "";
  }

  return hasRateValue(legacyHourlyRate)
    ? String(legacyHourlyRate)
    : "";
}

function readClientRate(shift) {
  const v =
    shift?.rates?.client ??
    shift?.clientRate ??
    shift?.billingRate ??
    shift?.clientHourlyRate ??
    shift?.clientRatePerHour ??
    shift?.rateClient ??
    shift?.rateClientPerHour ??
    "";
  return v === null || v === undefined ? "" : String(v);
}

function toNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function safeString(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function parseHHMM(t) {
  const s = safeString(t);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getShiftTypeFromStartTime(startTime) {
  const mins = parseHHMM(startTime);
  if (mins === null) return "—";
  return mins >= 6 * 60 && mins <= 18 * 60 + 59 ? "Day" : "Night";
}

function normalize4(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.padStart(4, "0");
}

/** ✅ Shift ID display (consistent, clean UI) */
function getShiftIdDisplay(shift) {
  const explicit =
    safeString(shift.shiftId) ||
    safeString(shift.shiftID) ||
    safeString(shift.referenceId) ||
    safeString(shift.refId);

  if (explicit) return explicit;

  const docId = safeString(shift.id);
  return docId ? docId.slice(0, 8).toUpperCase() : "—";
}

/* ------------------------------ */
/* ✅ Period helpers (1–7, 8–14...) */
/* ------------------------------ */

function toDateObj(tsLike) {
  try {
    if (tsLike?.toDate && typeof tsLike.toDate === "function") return tsLike.toDate();
    if (tsLike instanceof Date) return tsLike;
    return null;
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatGBDate(d) {
  if (!d) return "";
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/**
 * Period = 7-day blocks within a month:
 * 1–7, 8–14, 15–21, 22–28, 29–end
 * Example: 01/01/2026 - 07/01/2026
 */
function getPeriodRangeForDate(d) {
  if (!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth();
  const dim = daysInMonth(y, m);
  const day = d.getDate();

  const periodIndex = Math.floor((day - 1) / 7); // 0-based
  const startDay = periodIndex * 7 + 1;
  const endDay = Math.min(startDay + 6, dim);

  const start = new Date(y, m, startDay);
  start.setHours(0, 0, 0, 0);
  const end = new Date(y, m, endDay);
  end.setHours(23, 59, 59, 999);

  return { start, end, label: `${formatGBDate(start)} - ${formatGBDate(end)}` };
}

function toCSVCell(v) {
  const s = String(v ?? "");
  // escape quotes
  const escaped = s.replace(/"/g, '""');
  // quote if needed
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(toCSVCell).join(",")).join("\n");
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

/* ------------------------------------ */
/* ✅ Est. Bill helpers (non-breaking)   */
/* ------------------------------------ */

// Minutes duration, supports overnight (e.g., 20:00 -> 08:00)
function calcShiftDurationMinutes(startTime, endTime) {
  const s = parseHHMM(startTime);
  const e = parseHHMM(endTime);
  if (s === null || e === null) return null;

  let diff = e - s;
  if (diff < 0) diff += 24 * 60; // overnight
  if (diff === 0) return 0;
  if (diff < 0) return null;
  return diff;
}

function minutesToHours(mins) {
  if (!Number.isFinite(mins)) return null;
  return mins / 60;
}

function formatMoneyGBP(amount) {
  if (!Number.isFinite(amount)) return "—";
  return `£${amount.toFixed(2)}`;
}

// STEP37N_ASSIGNED_ADMIN_SHIFTS
const FIRESTORE_IN_QUERY_LIMIT = 10;

function chunkAdminQueryValues(
  values,
  size = FIRESTORE_IN_QUERY_LIMIT
) {
  const chunks = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
}

function normaliseAssignedClientIds(
  adminAccess
) {
  return Array.from(
    new Set(
      (
        Array.isArray(
          adminAccess?.assignedClientIds
        )
          ? adminAccess.assignedClientIds
          : []
      )
        .map((value) =>
          String(
            value || ""
          ).trim()
        )
        .filter(Boolean)
    )
  );
}

function adminScopeAllowsClient(
  adminAccess,
  scope,
  clientId
) {
  if (
    adminAccess?.isSuperAdmin ||
    scope === "all"
  ) {
    return true;
  }

  const cleanClientId =
    String(
      clientId || ""
    ).trim();

  return (
    scope === "assigned" &&
    Boolean(cleanClientId) &&
    normaliseAssignedClientIds(
      adminAccess
    ).includes(
      cleanClientId
    )
  );
}

function getShiftClientIdForAccess(
  shift
) {
  return String(
    shift?.clientId ||
    shift?.clientUid ||
    shift?.clientUserId ||
    shift?.createdBy ||
    ""
  ).trim();
}

function getShiftSortTime(
  shift
) {
  const value =
    shift?.date ||
    shift?.createdAt ||
    null;

  if (
    value?.toDate &&
    typeof value.toDate === "function"
  ) {
    return value
      .toDate()
      .getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed =
    new Date(value);

  return Number.isNaN(
    parsed.getTime()
  )
    ? 0
    : parsed.getTime();
}

export default function AdminShifts({ currentUser, adminAccess }) {
  const assignedClientIds =
    normaliseAssignedClientIds(
      adminAccess
    );

  const clientViewScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.clients?.view || "none";

  const shiftViewScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.shifts?.view || "none";

  const shiftCreateScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.shifts?.create || "none";

  const shiftEditScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.shifts?.edit || "none";

  const shiftAssignScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.shifts?.assign || "none";

  const shiftCancelScope =
    adminAccess?.isSuperAdmin
      ? "all"
      : adminAccess?.permissions
          ?.shifts?.cancel || "none";

  const canViewUsers =
    Boolean(
      adminAccess?.isSuperAdmin ||
      adminAccess?.permissions
        ?.users?.view === true
    );

  const canCreateShiftForClient =
    (clientId) =>
      adminScopeAllowsClient(
        adminAccess,
        shiftCreateScope,
        clientId
      );

  const canEditShiftForClient =
    (clientId) =>
      adminScopeAllowsClient(
        adminAccess,
        shiftEditScope,
        clientId
      );

  const canAssignShiftForClient =
    (clientId) =>
      adminScopeAllowsClient(
        adminAccess,
        shiftAssignScope,
        clientId
      );

  const canCancelShiftForClient =
    (clientId) =>
      adminScopeAllowsClient(
        adminAccess,
        shiftCancelScope,
        clientId
      );

  const canCreateAnyShift =
    shiftCreateScope === "all" ||
    (
      shiftCreateScope === "assigned" &&
      assignedClientIds.length > 0
    );

  const canMutateAnyShift =
    adminAccess?.isSuperAdmin ||
    [
      shiftEditScope,
      shiftAssignScope,
      shiftCancelScope,
    ].some(
      (scope) =>
        scope === "all" ||
        (
          scope === "assigned" &&
          assignedClientIds.length > 0
        )
    );

  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  // Admin shift creation
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [showCreateShift, setShowCreateShift] = useState(false);
  const [creatingShift, setCreatingShift] = useState(false);
  const [createShiftError, setCreateShiftError] = useState("");

  const [createShiftForm, setCreateShiftForm] = useState({
    clientId: "",
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    address: "",
    postcode: "",
    landmarks: "",
    role: "",
    clientRate: "",
    staffRate: "",
    staffNeeded: "1",
  });
  // Admin direct staff assignment
  const [staffMembers, setStaffMembers] = useState([]);
  const [loadingStaffMembers, setLoadingStaffMembers] = useState(false);

  const [assigningShift, setAssigningShift] = useState(null);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [assigningStaff, setAssigningStaff] = useState(false);
  const [assignStaffError, setAssignStaffError] = useState("");
  // ✅ cache: uid -> { name, publicId }
  const [userCache, setUserCache] = useState({});

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("");

  // ✅ NEW: period filter (optional)
  const [periodFilter, setPeriodFilter] = useState("all"); // all | current | custom
  const [periodStart, setPeriodStart] = useState(""); // yyyy-mm-dd
  const [periodEnd, setPeriodEnd] = useState(""); // yyyy-mm-dd

  // Sort
  const [sortBy, setSortBy] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Editing
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    address: "",
    role: "",
    staffRate: "",
    clientRate: "",
  });

  // ✅ expanded details rows (shiftId -> boolean)
  const [expanded, setExpanded] = useState({});

  const toggleExpanded = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const setExpandedOn = (id, on = true) => {
    setExpanded((prev) => ({ ...prev, [id]: !!on }));
  };

    const loadShifts = async () => {
    setLoading(true);
    setError("");

    try {
      const shiftsReference =
        collection(
          db,
          "shifts"
        );

      let documents = [];

      if (
        shiftViewScope === "all"
      ) {
        const snapshot =
          await getDocs(
            query(
              shiftsReference,
              orderBy(
                "date",
                "desc"
              )
            )
          );

        documents =
          snapshot.docs;
      } else if (
        shiftViewScope === "assigned"
      ) {
        if (
          assignedClientIds.length === 0
        ) {
          setShifts([]);
          return;
        }

        const snapshots =
          await Promise.all(
            chunkAdminQueryValues(
              assignedClientIds
            ).map(
              (clientIdChunk) =>
                getDocs(
                  query(
                    shiftsReference,
                    where(
                      "clientId",
                      "in",
                      clientIdChunk
                    )
                  )
                )
            )
          );

        documents =
          snapshots.flatMap(
            (snapshot) =>
              snapshot.docs
          );
      } else {
        setShifts([]);
        return;
      }

      const byDocumentId =
        new Map();

      for (
        const shiftDocument of
        documents
      ) {
        byDocumentId.set(
          shiftDocument.id,
          {
            id:
              shiftDocument.id,

            ...shiftDocument.data(),
          }
        );
      }

      const data =
        Array.from(
          byDocumentId.values()
        ).sort(
          (left, right) =>
            getShiftSortTime(right) -
            getShiftSortTime(left)
        );

      setShifts(data);
    } catch (err) {
      console.error(
        "Error loading shifts:",
        err
      );

      setError(
        "Could not load shifts."
      );
    } finally {
      setLoading(false);
    }
  };
    const loadClients = async () => {
    setLoadingClients(true);
    setCreateShiftError("");

    try {
      const clientsReference =
        collection(
          db,
          "clients"
        );

      let documents = [];

      if (
        clientViewScope === "all"
      ) {
        const snapshot =
          await getDocs(
            clientsReference
          );

        documents =
          snapshot.docs;
      } else if (
        clientViewScope === "assigned"
      ) {
        if (
          assignedClientIds.length === 0
        ) {
          setClients([]);
          return;
        }

        const snapshots =
          await Promise.all(
            chunkAdminQueryValues(
              assignedClientIds
            ).map(
              (clientIdChunk) =>
                getDocs(
                  query(
                    clientsReference,
                    where(
                      documentId(),
                      "in",
                      clientIdChunk
                    )
                  )
                )
            )
          );

        documents =
          snapshots.flatMap(
            (snapshot) =>
              snapshot.docs
          );
      } else {
        setClients([]);
        return;
      }

      const byDocumentId =
        new Map();

      for (
        const clientDocument of
        documents
      ) {
        byDocumentId.set(
          clientDocument.id,
          {
            id:
              clientDocument.id,

            ...clientDocument.data(),
          }
        );
      }

      const data =
        Array.from(
          byDocumentId.values()
        )
          .filter(
            (client) => {
              const status =
                String(
                  client.status || ""
                ).toLowerCase();

              return (
                client.isActive === true ||
                status === "active"
              );
            }
          )
          .sort(
            (left, right) => {
              const leftName =
                String(
                  left.organisationName ||
                  left.organizationName ||
                  left.companyName ||
                  left.contactName ||
                  left.email ||
                  ""
                );

              const rightName =
                String(
                  right.organisationName ||
                  right.organizationName ||
                  right.companyName ||
                  right.contactName ||
                  right.email ||
                  ""
                );

              return leftName.localeCompare(
                rightName
              );
            }
          );

      setClients(data);
    } catch (err) {
      console.error(
        "Error loading clients:",
        err
      );

      setCreateShiftError(
        "Could not load the active clients."
      );
    } finally {
      setLoadingClients(false);
    }
  };
  const loadStaffMembers = async () => {
    if (!canViewUsers) {
      setStaffMembers([]);
      setLoadingStaffMembers(false);
      return;
    }

    setLoadingStaffMembers(true);

    try {
      const snapshot = await getDocs(collection(db, "users"));

      const data = snapshot.docs
        .map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }))
        .filter((user) => {
          const accountRole = String(
            user.role || user.accountType || ""
          ).toLowerCase();

          const status = String(
            user.status || user.accountStatus || ""
          ).toLowerCase();

          const isStaff =
            accountRole === "staff" ||
            user.isStaff === true;

          const isActive =
            user.isActive === true ||
            status === "active" ||
            status === "approved" ||
            status === "enabled";

          const isOnboarded =
            user.onboardingCompleted === true ||
            user.onboarded === true;

          return isStaff && isActive && isOnboarded;
        })
        .sort((first, second) => {
          const firstName = String(
            first.fullName ||
            first.name ||
            first.displayName ||
            first.email ||
            ""
          ).toLowerCase();

          const secondName = String(
            second.fullName ||
            second.name ||
            second.displayName ||
            second.email ||
            ""
          ).toLowerCase();

          return firstName.localeCompare(secondName);
        });

      setStaffMembers(data);
    } catch (err) {
      console.error("Error loading staff members:", err);
      setAssignStaffError(
        "Could not load active staff members."
      );
    } finally {
      setLoadingStaffMembers(false);
    }
  };
  // ------------------------------------------------------
  // Admin creates a shift for a selected client
  // ------------------------------------------------------

  const getClientDisplayName = (client) =>
    client?.organisationName ||
    client?.organizationName ||
    client?.companyName ||
    client?.businessName ||
    client?.contactName ||
    client?.email ||
    "Unnamed client";

  const getClientCode = (client) => {
    const rawCode = String(
      client?.clientCode ||
      client?.clientPublicId ||
      client?.publicId ||
      ""
    ).trim();

    return rawCode ? rawCode.padStart(4, "0") : "";
  };
  const getClientAddress = (client) => {
    const address = client?.organisationAddress;

    if (typeof address === "string") {
      return address;
    }

    if (address && typeof address === "object") {
      return [
        address.addressLine1,
        address.addressLine2,
        address.town,
        address.city,
        address.county,
      ]
        .filter(Boolean)
        .join(", ");
    }

    return (
      client?.organisationAddressText ||
      client?.address ||
      ""
    );
  };

  const getClientPostcode = (client) =>
    client?.organisationAddress?.postcode ||
    client?.organisationPostcode ||
    client?.postcode ||
    "";

  const resetCreateShiftForm = () => {
    setCreateShiftForm({
      clientId: "",
      date: "",
      startTime: "",
      endTime: "",
      location: "",
      address: "",
      postcode: "",
      landmarks: "",
      role: "",
      clientRate: "",
      staffRate: "",
      staffNeeded: "1",
    });

    setCreateShiftError("");
  };

  const handleCreateShiftChange = (event) => {
    const { name, value } = event.target;

    setCreateShiftForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleCreateShiftClientChange = (event) => {
    const clientId = event.target.value;
    const selectedClient = clients.find(
      (client) => client.id === clientId
    );

    setCreateShiftForm((previous) => ({
      ...previous,
      clientId,
      location: selectedClient
        ? getClientDisplayName(selectedClient)
        : "",
      address: selectedClient
        ? getClientAddress(selectedClient)
        : "",
      postcode: selectedClient
        ? getClientPostcode(selectedClient)
        : "",
    }));
  };

  const submitAdminCreatedShift = async (event) => {
    event.preventDefault();
    setCreateShiftError("");

    if (!createShiftForm.clientId) {
      setCreateShiftError("Please select a client.");
      return;
    }

  if (
    !canCreateShiftForClient(
      createShiftForm.clientId
    )
  ) {
    setCreateShiftError(
      "You do not have permission to create shifts for this client."
    );
    return;
  }

    if (
      !createShiftForm.date ||
      !createShiftForm.startTime ||
      !createShiftForm.endTime
    ) {
      setCreateShiftError(
        "Please enter the shift date, start time and end time."
      );
      return;
    }

    if (!createShiftForm.location || !createShiftForm.role) {
      setCreateShiftError(
        "Please enter the shift location and required role."
      );
      return;
    }

    try {
      setCreatingShift(true);

      const adminCreateShift = httpsCallable(
        functions,
        "adminCreateShiftV2"
      );

      const response = await adminCreateShift({
        clientId: createShiftForm.clientId,
        date: createShiftForm.date,
        startTime: createShiftForm.startTime,
        endTime: createShiftForm.endTime,
        location: createShiftForm.location,
        address: createShiftForm.address,
        postcode: createShiftForm.postcode,
        landmarks: createShiftForm.landmarks,
        role: createShiftForm.role,
        clientRate: createShiftForm.clientRate,
        staffRate: createShiftForm.staffRate,
        staffNeeded: createShiftForm.staffNeeded,
      });

      if (!response?.data?.ok) {
        throw new Error(
          response?.data?.message || "Could not create the shift."
        );
      }

      await loadShifts();

      alert(
        response.data.message || "Shift created successfully."
      );

      resetCreateShiftForm();
      setShowCreateShift(false);
    } catch (err) {
      console.error("Error creating admin shift:", err);

      const message =
        err?.details ||
        err?.message ||
        "Could not create the shift.";

      setCreateShiftError(message);
      alert(message);
    } finally {
      setCreatingShift(false);
    }
  };
  // ------------------------------------------------------
  // Admin staff-selection helpers
  // ------------------------------------------------------

  const getAssignableStaffName = (staff) => {
    const otherNames = String(
      staff?.otherNames || ""
    ).trim();

    const surname = String(
      staff?.surname || ""
    ).trim();

    const applicationName = [
      otherNames,
      surname,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    return (
      staff?.fullName ||
      applicationName ||
      staff?.name ||
      staff?.displayName ||
      [
        staff?.firstName,
        staff?.lastName ||
        staff?.surname,
      ]
        .filter(Boolean)
        .join(" ") ||
      staff?.email ||
      "Unnamed staff"
    );
  };

  const getAssignableStaffRole = (staff) => {
    const accountRole = safeString(
      staff?.role || staff?.accountType
    ).toLowerCase();

    return (
      staff?.staffRole ||
      staff?.roleName ||
      staff?.position ||
      staff?.jobRole ||
      staff?.primaryRole ||
      staff?.roleType ||
      (accountRole !== "staff" && accountRole !== "user"
        ? staff?.role
        : "") ||
      "Role not recorded"
    );
  };

  const getAssignableStaffPublicId = (staff) =>
    normalize4(
      staff?.publicId ||
      staff?.publicID ||
      staff?.staffCode ||
      staff?.code
    );

  const getAssignableStaffMaxHours = (staff) => {
    const value =
      staff?.maxWeeklyHours ??
      staff?.maxHoursPerWeek ??
      staff?.weeklyMaxHours ??
      staff?.weeklyHoursLimit ??
      staff?.visaWeeklyHoursLimit ??
      null;

    const number =
      value === null || value === undefined || value === ""
        ? null
        : Number(value);

    return Number.isFinite(number) && number > 0
      ? number
      : null;
  };

  const openAssignStaff = (shift) => {
    if (
      !canAssignShiftForClient(
        getShiftClientIdForAccess(
          shift
        )
      )
    ) {
      return;
    }

    const status = safeString(shift?.status).toLowerCase();

    if (status !== "open") {
      alert("Only open shifts can be assigned directly.");
      return;
    }

    setAssigningShift(shift);
    setStaffSearch("");
    setSelectedStaffId("");
    setAssignStaffError("");

    setExpandedOn(shift.id, true);
  };

  const closeAssignStaff = () => {
    if (assigningStaff) return;

    setAssigningShift(null);
    setStaffSearch("");
    setSelectedStaffId("");
    setAssignStaffError("");
  };

  const filteredAssignableStaff = useMemo(() => {
    const search = staffSearch.trim().toLowerCase();

    if (!search) {
      return staffMembers;
    }

    return staffMembers.filter((staff) => {
      const name = getAssignableStaffName(staff).toLowerCase();
      const email = safeString(staff.email).toLowerCase();
      const role = getAssignableStaffRole(staff).toLowerCase();
      const publicId =
        getAssignableStaffPublicId(staff).toLowerCase();

      return (
        name.includes(search) ||
        email.includes(search) ||
        role.includes(search) ||
        publicId.includes(search)
      );
    });
  }, [staffMembers, staffSearch]);

  const selectedStaffMember = useMemo(
    () =>
      staffMembers.find(
        (staff) => staff.id === selectedStaffId
      ) || null,
    [staffMembers, selectedStaffId]
  );

  const submitAdminStaffAssignment = async (event) => {
    if (
      !assigningShift ||
      !canAssignShiftForClient(
        getShiftClientIdForAccess(
          assigningShift
        )
      )
    ) {
      alert(
        "You do not have permission to assign staff to this shift."
      );
      return;
    }

    event.preventDefault();
    setAssignStaffError("");

    if (!assigningShift?.id) {
      setAssignStaffError("Please select an open shift.");
      return;
    }

    if (!selectedStaffId || !selectedStaffMember) {
      setAssignStaffError("Please select a staff member.");
      return;
    }

    const staffName =
      getAssignableStaffName(selectedStaffMember);

    const clientName =
      assigningShift.clientOrganisation ||
      assigningShift.clientOrgName ||
      assigningShift.clientName ||
      assigningShift.clientCompany ||
      assigningShift.clientEmail ||
      "the client";

    const confirmed = window.confirm(
      `Assign ${staffName} to the ${assigningShift.role || "selected"} shift for ${clientName} on ${assigningShift.date?.toDate
        ? assigningShift.date.toDate().toLocaleDateString()
        : "the selected date"
      } from ${assigningShift.startTime || "?"} to ${assigningShift.endTime || "?"
      }?`
    );

    if (!confirmed) return;

    try {
      setAssigningStaff(true);

      const adminAssignShift = httpsCallable(
        functions,
        "adminAssignShiftV2"
      );

      const response = await adminAssignShift({
        shiftId: assigningShift.id,
        staffId: selectedStaffId,
      });

      if (!response?.data?.ok) {
        throw new Error(
          response?.data?.message ||
          "Could not assign the staff member."
        );
      }

      await loadShifts();

      alert(
        response.data.message ||
        `${staffName} has been assigned successfully.`
      );

      setAssigningShift(null);
      setStaffSearch("");
      setSelectedStaffId("");
      setAssignStaffError("");
    } catch (err) {
      console.error("Error assigning staff:", err);

      const message =
        err?.details ||
        err?.message ||
        "Could not assign the staff member.";

      setAssignStaffError(message);
      alert(message);
    } finally {
      setAssigningStaff(false);
    }
  };
  useEffect(() => {
    loadShifts();
    loadClients();
    loadStaffMembers();
  }, []);
  // ✅ created-by UID accessor (kept for future compatibility)
  const getCreatedByUid = (shift) =>
    shift?.createdByUid || shift?.createdBy || shift?.createdById || null;

  // ✅ cache any referenced users (createdBy + booked staff)
  useEffect(() => {
    const run = async () => { 
      if (!canViewUsers) {
        setUserCache({});
        return;
      }

      const staffUids = shifts
        .map((s) => s.bookedStaffId || s.bookedBy || s.requestedStaffId || null)
        .filter(Boolean);

      const createdByUids = shifts
        .map((s) => getCreatedByUid(s))
        .filter(Boolean);

      const allUids = Array.from(new Set([...staffUids, ...createdByUids]));
      const missing = allUids.filter((uid) => !userCache[uid]);
      if (!missing.length) return;

      const updates = {};
      for (const uid of missing) {
        try {
          const uref = doc(db, "users", uid);
          const usnap = await getDoc(uref);
          if (!usnap.exists()) continue;
          const u = usnap.data();

          const publicId =
            safeString(u.publicId || u.publicID || u.staffCode || u.code) ||
            null;
          const name =
            u.fullName || u.name || u.displayName || u.firstName || null;

          updates[uid] = { publicId, name };
        } catch (e) {
          console.error("Error caching user:", uid, e);
        }
      }

      if (Object.keys(updates).length) {
        setUserCache((prev) => ({ ...prev, ...updates }));
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, canViewUsers]);

  // ✅ Client display: Name + FOUR DIGIT ID ONLY
  const getClientName = (shift) =>
    shift.clientOrganisation ||
    shift.clientOrgName ||
    shift.clientName ||
    shift.clientCompany ||
    shift.clientEmail ||
    "Unknown client";

  const getClientPublicId = (shift) =>
    normalize4(
      shift.clientPublicId ||
      shift.clientPublicID ||
      shift.clientCode ||
      ""
    );
  const getClientEmail = (shift) => safeString(shift.clientEmail);

  // ✅ Paid badge (non-breaking: reads optional fields)
  function readPaidFlag(shift) {
    const s =
      safeString(shift?.paymentStatus) ||
      safeString(shift?.invoiceStatus) ||
      safeString(shift?.billingStatus) ||
      safeString(shift?.paidStatus);

    if (s) return s.toLowerCase() === "paid";

    // boolean variants
    if (shift?.isPaid === true) return true;
    if (shift?.paid === true) return true;

    return false;
  }

  const getPaidBadge = (shift) => {
    const paid = readPaidFlag(shift);
    if (!paid) return null;
    return {
      label: "Paid",
      className: "bg-violet-50 text-violet-800 border border-violet-200",
    };
  };

  const getStatusBadge = (status) => {
    const s = (status || "").toLowerCase();

    if (s === "open")
      return {
        label: "Open",
        className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };

    if (s === "pending_admin")
      return {
        label: "Pending admin approval",
        className: "bg-amber-50 text-amber-800 border border-amber-200",
      };

    if (s === "client_pending" || s === "pending")
      return {
        label: "Client pending",
        className: "bg-amber-50 text-amber-700 border border-amber-200",
      };

    if (s === "booked")
      return {
        label: "Booked",
        className: "bg-blue-50 text-blue-700 border border-blue-200",
      };

    // ✅ ADDED
    if (s === "completed")
      return {
        label: "Completed",
        className: "bg-emerald-50 text-emerald-800 border border-emerald-200",
      };

    // ✅ ADDED
    if (s === "null")
      return {
        label: "Null",
        className: "bg-slate-100 text-slate-600 border border-slate-200",
      };

    if (s === "cancelled")
      return {
        label: "Cancelled",
        className: "bg-rose-50 text-rose-700 border border-rose-200",
      };

    return {
      label: s || "Unknown",
      className: "bg-slate-50 text-slate-600 border border-slate-200",
    };
  };

  const updateShiftStatus = async (shift, newStatus) => {
    const shiftClientId =
      getShiftClientIdForAccess(
        shift
      );

    const statusPermissionAllowed =
      newStatus === "cancelled"
        ? canCancelShiftForClient(
            shiftClientId
          )
        : canEditShiftForClient(
            shiftClientId
          );

    if (!statusPermissionAllowed) {
      alert(
        "You do not have permission to change this shift status."
      );
      return;
    }

    if (!currentUser) return;

    const messages = {
      open: "Approve/confirm this shift and make it open to staff?",
      booked: "Mark this shift as booked?",
      cancelled: "Cancel this shift?",
      // ✅ ADDED
      completed: "Mark this shift as completed?",
      // ✅ ADDED
      null: 'Mark this shift as "null"?',
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

  // ✅ NEW: admin toggles "Paid" (non-breaking: writes paymentStatus + isPaid)
  const setPaidStatus = async (shift, paid) => {
    if (
      !canEditShiftForClient(
        getShiftClientIdForAccess(
          shift
        )
      )
    ) {
      alert(
        "You do not have permission to edit this shift."
      );
      return;
    }

    if (!currentUser) return;

    const msg = paid
      ? "Mark this shift as PAID (invoice settled)?"
      : "Mark this shift as NOT PAID?";
    if (!window.confirm(msg)) return;

    try {
      setSavingId(shift.id);
      const ref = doc(db, "shifts", shift.id);

      await updateDoc(ref, {
        // non-breaking: support both string + boolean readers elsewhere
        paymentStatus: paid ? "paid" : "unpaid",
        isPaid: !!paid,

        paidAt: paid ? new Date() : null,
        paidByAdminId: paid ? currentUser.uid : null,
        paidByAdminEmail: paid ? currentUser.email || null : null,

        updatedByAdminId: currentUser.uid,
        updatedAt: new Date(),
      });

      await loadShifts();
    } catch (err) {
      console.error("Error updating paid status:", err);
      alert("Could not update paid status.");
    } finally {
      setSavingId(null);
    }
  };

  const approveStaffBooking = async (shift) => {
    if (
      !canAssignShiftForClient(
        getShiftClientIdForAccess(
          shift
        )
      )
    ) {
      alert(
        "You do not have permission to assign staff to this shift."
      );
      return;
    }

    if (!currentUser) return;
    if (!window.confirm("Approve this staff booking and mark shift as booked?"))
      return;

    try {
      setSavingId(shift.id);
      const ref = doc(db, "shifts", shift.id);

      await updateDoc(ref, {
        status: "booked",
        approvedByAdminId: currentUser.uid,
        approvedByAdminEmail: currentUser.email || null,
        approvedAt: new Date(),
        updatedByAdminId: currentUser.uid,
        updatedAt: new Date(),
      });

      await loadShifts();
      alert("Staff booking approved.");
    } catch (err) {
      console.error("Error approving staff booking:", err);
      alert("Could not approve staff booking.");
    } finally {
      setSavingId(null);
    }
  };

  const startEdit = (shift) => {
    if (
      !canEditShiftForClient(
        getShiftClientIdForAccess(
          shift
        )
      )
    ) {
      return;
    }

    const dateObj = shift.date?.toDate ? shift.date.toDate() : null;
    const dateStr = dateObj ? dateObj.toISOString().slice(0, 10) : "";

    setEditForm({
      date: dateStr,
      startTime: shift.startTime || "",
      endTime: shift.endTime || "",
      location: shift.location || "",
      address: shift.address || "",
      role: shift.role || "",
      staffRate: readStaffRate(shift),
      clientRate: readClientRate(shift),
    });

    setEditingId(shift.id);

    // ✅ Ensure details row is visible while editing
    setExpandedOn(shift.id, true);
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
      staffRate: "",
      clientRate: "",
    });
  };

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveEdit = async (shift) => {
    if (
      !canEditShiftForClient(
        getShiftClientIdForAccess(
          shift
        )
      )
    ) {
      alert(
        "You do not have permission to edit this shift."
      );
      return;
    }

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

    const staffRateNum = toNumberOrNull(editForm.staffRate);
    const clientRateNum = toNumberOrNull(editForm.clientRate);

    if (String(editForm.staffRate).trim() && staffRateNum === null) {
      alert("Staff rate must be a valid number.");
      return;
    }
    if (String(editForm.clientRate).trim() && clientRateNum === null) {
      alert("Client billing rate must be a valid number.");
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
        updatedByAdminId: currentUser.uid,
        updatedAt: new Date(),
      };

      // date
      const d = new Date(editForm.date);
      d.setHours(0, 0, 0, 0);
      updateData.date = Timestamp.fromDate(d);

      // rates object merge-safe
      const existingRates =
        shift.rates && typeof shift.rates === "object" ? shift.rates : {};
      const nextRates = { ...existingRates };

      // staff rate
      if (String(editForm.staffRate).trim()) {
        nextRates.staff = staffRateNum;

        // legacy staff mirrors
        updateData.hourlyRate = staffRateNum;
        updateData.staffRate = staffRateNum;
        updateData.staffRatePerHour = staffRateNum;
      }

      // client rate
      if (String(editForm.clientRate).trim()) {
        nextRates.client = clientRateNum;

        // legacy client mirrors (billing)
        updateData.clientRate = clientRateNum;
        updateData.billingRate = clientRateNum;
        updateData.clientHourlyRate = clientRateNum;
      }

      updateData.rates = nextRates;

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

  // ✅ period range derived from controls
  const activePeriodRange = useMemo(() => {
    // current = based on today, using 7-day-in-month blocks (same labeling)
    if (periodFilter === "current") {
      const now = new Date();
      return getPeriodRangeForDate(now);
    }

    if (periodFilter === "custom") {
      if (!periodStart || !periodEnd) return null;
      const s = new Date(periodStart);
      const e = new Date(periodEnd);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;

      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);

      if (s > e) return null;

      return { start: s, end: e, label: `${formatGBDate(s)} - ${formatGBDate(e)}` };
    }

    return null; // all
  }, [periodFilter, periodStart, periodEnd]);

  const filteredAndSorted = useMemo(() => {
    let list = [...shifts];

    // ✅ period filter (does not affect existing logic unless selected)
    if (activePeriodRange?.start && activePeriodRange?.end) {
      const startMs = activePeriodRange.start.getTime();
      const endMs = activePeriodRange.end.getTime();
      list = list.filter((s) => {
        const d = toDateObj(s.date) || toDateObj(s.createdAt) || null;
        if (!d) return false;
        const ms = d.getTime();
        return ms >= startMs && ms <= endMs;
      });
    }

    if (statusFilter !== "all") {
      list = list.filter((s) => {
        const st = (s.status || "").toLowerCase();
        if (statusFilter === "open") return st === "open";
        if (statusFilter === "pending_admin") return st === "pending_admin";
        if (statusFilter === "client_pending")
          return st === "client_pending" || st === "pending";
        if (statusFilter === "booked") return st === "booked";
        if (statusFilter === "cancelled") return st === "cancelled";

        // ✅ ADDED
        if (statusFilter === "completed") return st === "completed";
        // ✅ ADDED
        if (statusFilter === "null") return st === "null";

        return true;
      });
    }

    if (clientFilter.trim()) {
      const term = clientFilter.toLowerCase();
      list = list.filter((s) => {
        const cName = (getClientName(s) || "").toLowerCase();
        const cEmail = (s.clientEmail || "").toLowerCase();
        const cId = (getClientPublicId(s) || "").toLowerCase();
        return cName.includes(term) || cEmail.includes(term) || cId.includes(term);
      });
    }

    list.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortBy === "client") {
        aVal = (getClientName(a) || "").toLowerCase();
        bVal = (getClientName(b) || "").toLowerCase();
      } else if (sortBy === "status") {
        aVal = (a.status || "").toLowerCase();
        bVal = (b.status || "").toLowerCase();
      } else if (sortBy === "period") {
        // sort by computed 7-day period start (within month)
        const ad = toDateObj(a.date) || toDateObj(a.createdAt) || null;
        const bd = toDateObj(b.date) || toDateObj(b.createdAt) || null;
        const ar = getPeriodRangeForDate(ad);
        const br = getPeriodRangeForDate(bd);
        aVal = ar?.start ? ar.start.getTime() : 0;
        bVal = br?.start ? br.start.getTime() : 0;
      } else {
        const aDate = a.date?.toDate?.() || a.createdAt?.toDate?.() || null;
        const bDate = b.date?.toDate?.() || b.createdAt?.toDate?.() || null;
        aVal = aDate ? aDate.getTime() : 0;
        bVal = bDate ? bDate.getTime() : 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [
    shifts,
    statusFilter,
    clientFilter,
    sortBy,
    sortDirection,
    activePeriodRange,
  ]);

  /** ✅ Staff display: Name + ID only */
  const getStaffDisplay = (shift) => {
    const uid =
      shift.bookedStaffId || shift.bookedBy || shift.requestedStaffId || null;
    if (!uid) return "—";

    const cached = userCache[uid] || null;
    const name = shift.bookedStaffName || cached?.name || "—";
    const publicId =
      safeString(shift.bookedStaffPublicId) ||
      safeString(shift.staffPublicId) ||
      (cached?.publicId ? safeString(cached.publicId) : "");

    return publicId ? `${name} (${publicId})` : `${name}`;
  };

  /** ✅ Created-by display (audit)
   * Uses your stored "shiftBookedBy" first (e.g., "Jude"), then falls back to uid-based cache.
   */
  const getCreatedByDisplay = (shift) => {
    // ✅ Your actual stored field (name)
    const bookedByName = safeString(shift?.shiftBookedBy);
    if (bookedByName) return bookedByName;

    // If later you store a UID, this supports it
    const uid = getCreatedByUid(shift);
    if (uid) {
      const cached = userCache[uid] || null;

      const name =
        safeString(shift.createdByName) ||
        safeString(shift.postedByName) ||
        cached?.name ||
        "—";

      const publicId =
        safeString(shift.createdByPublicId) ||
        safeString(shift.createdByStaffPublicId) ||
        safeString(shift.postedByPublicId) ||
        (cached?.publicId ? safeString(cached.publicId) : "");

      return publicId ? `${name} (${publicId})` : `${name}`;
    }

    // Other best-effort fallbacks
    const name =
      safeString(shift?.createdByName) ||
      safeString(shift?.postedByName) ||
      safeString(shift?.creatorName) ||
      safeString(shift?.createdByFullName) ||
      safeString(shift?.postedByFullName);

    const email =
      safeString(shift?.createdByEmail) ||
      safeString(shift?.postedByEmail) ||
      safeString(shift?.creatorEmail) ||
      safeString(shift?.clientEmail);

    if (name && email) return `${name} (${email})`;
    if (name) return name;
    if (email) return email;

    // last resort: show client org/id (still audit helpful)
    const clientName =
      shift?.clientOrganisation ||
      shift?.clientOrgName ||
      shift?.clientName ||
      shift?.clientCompany ||
      "";
    const clientId = getClientPublicId(shift);

    if (clientName && clientId) return `${clientName} (${clientId})`;
    if (clientName) return clientName;

    return "—";
  };

  // ✅ Small detail pill
  const DetailPill = ({ label, value }) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
      <span className="font-semibold text-slate-600">{label}:</span>
      <span className="text-slate-900">{value || "—"}</span>
    </span>
  );

  // ✅ CSV download (exports current filtered + sorted view)
  const downloadCurrentCSV = () => {
    const rows = [];
    const header = [
      "Shift DocId",
      "Shift ID (Display)",
      "Period",
      "Date",
      "Start Time",
      "End Time",
      "Type",
      "Client Name",
      "Client 4-digit ID",
      "Client Email",
      "Location",
      "Address",
      "Role",
      "Staff Rate",
      "Client Rate",
      "Est. Hours",
      "Est. Bill",
      "Status",
      "Paid",
      "Created By",
      "Staff",
    ];
    rows.push(header);

    for (const s of filteredAndSorted) {
      const d = toDateObj(s.date) || toDateObj(s.createdAt) || null;
      const period = getPeriodRangeForDate(d);
      const shiftType = getShiftTypeFromStartTime(s.startTime);
      const staffRateNum = toNumberOrNull(readStaffRate(s));
      const clientRateNum = toNumberOrNull(readClientRate(s));

      const mins = calcShiftDurationMinutes(s.startTime, s.endTime);
      const hours = minutesToHours(mins);
      const estBill =
        typeof clientRateNum === "number" && typeof hours === "number"
          ? clientRateNum * hours
          : null;

      rows.push([
        safeString(s.id),
        getShiftIdDisplay(s),
        period?.label || "",
        d ? formatGBDate(d) : "",
        safeString(s.startTime),
        safeString(s.endTime),
        shiftType,
        getClientName(s),
        getClientPublicId(s),
        safeString(s.clientEmail),
        safeString(s.location),
        safeString(s.address),
        safeString(s.role),
        typeof staffRateNum === "number" ? staffRateNum.toFixed(2) : "",
        typeof clientRateNum === "number" ? clientRateNum.toFixed(2) : "",
        typeof hours === "number" ? hours.toFixed(2) : "",
        typeof estBill === "number" ? estBill.toFixed(2) : "",
        safeString(s.status),
        readPaidFlag(s) ? "PAID" : "",
        getCreatedByDisplay(s),
        getStaffDisplay(s),
      ]);
    }

    const periodSuffix = activePeriodRange?.label
      ? `_${activePeriodRange.label.replaceAll("/", "-").replaceAll(" ", "")}`
      : "";
    const fileName = `shifts_export${periodSuffix}.csv`;
    downloadCSV(fileName, rows);
  };

  // ✅ Estimated total (for admin visibility) - based on CURRENT filtered view
  const estimatedTotals = useMemo(() => {
    let total = 0;
    let countIncluded = 0;

    for (const s of filteredAndSorted) {
      const clientRateNum = toNumberOrNull(readClientRate(s));
      const mins = calcShiftDurationMinutes(s.startTime, s.endTime);
      const hours = minutesToHours(mins);

      if (typeof clientRateNum === "number" && typeof hours === "number") {
        total += clientRateNum * hours;
        countIncluded += 1;
      }
    }

    return { total, countIncluded };
  }, [filteredAndSorted]);

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
        {canCreateAnyShift && (
<button
          type="button"
          onClick={() => {
            if (showCreateShift) {
              resetCreateShiftForm();
            }

            setShowCreateShift((previous) => !previous);
          }}
          className="inline-flex items-center justify-center rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-cyan-700"
        >
          {showCreateShift ? "Close Create Shift Form" : "Create Shift for Client"}
        </button>
)}
        <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
          <span>
            Total shifts:{" "}
            <span className="font-semibold text-slate-800">{shifts.length}</span>
          </span>
          <span>
            Open:{" "}
            <span className="font-semibold text-emerald-700">
              {
                shifts.filter((s) => (s.status || "").toLowerCase() === "open")
                  .length
              }
            </span>
          </span>

          {/* ✅ ADDED: estimated total for current view (non-breaking) */}
          <span className="mt-1">
            Est. total (current view):{" "}
            <span className="font-semibold text-slate-800">
              {formatMoneyGBP(estimatedTotals.total)}
            </span>
            <span className="text-slate-400">
              {" "}
              ({estimatedTotals.countIncluded}/{filteredAndSorted.length} shifts)
            </span>
          </span>
        </div>
      </div>
      {canCreateAnyShift && showCreateShift && (
        <div className="card border border-cyan-200 bg-cyan-50/30">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Create Shift for Client
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Select an active client and enter the shift details. The shift will
              become immediately available to suitable staff.
            </p>
          </div>

          {createShiftError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {createShiftError}
            </div>
          )}

          <form onSubmit={submitAdminCreatedShift} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Client
                </label>

                <select
                  name="clientId"
                  value={createShiftForm.clientId}
                  onChange={handleCreateShiftClientChange}
                  className="input"
                  disabled={loadingClients || creatingShift}
                  required
                >
                  <option value="">
                    {loadingClients
                      ? "Loading active clients..."
                      : "Select an active client"}
                  </option>

                  {clients.map((client) => {
                    const clientCode = getClientCode(client);

                    return (
                      <option key={client.id} value={client.id}>
                        {getClientDisplayName(client)}
                        {clientCode ? ` (${clientCode})` : ""}
                      </option>
                    );
                  })}
                </select>

                {!loadingClients && clients.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    No active clients were found.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Number of staff
                </label>

                <input
                  type="number"
                  name="staffNeeded"
                  min="1"
                  max="50"
                  step="1"
                  value={createShiftForm.staffNeeded}
                  onChange={handleCreateShiftChange}
                  className="input"
                  disabled={creatingShift}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Shift date
                </label>

                <input
                  type="date"
                  name="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={createShiftForm.date}
                  onChange={handleCreateShiftChange}
                  className="input"
                  disabled={creatingShift}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Start time
                </label>

                <input
                  type="time"
                  name="startTime"
                  value={createShiftForm.startTime}
                  onChange={handleCreateShiftChange}
                  className="input"
                  disabled={creatingShift}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  End time
                </label>

                <input
                  type="time"
                  name="endTime"
                  value={createShiftForm.endTime}
                  onChange={handleCreateShiftChange}
                  className="input"
                  disabled={creatingShift}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Required role
                </label>

                <select
                  name="role"
                  value={createShiftForm.role}
                  onChange={handleCreateShiftChange}
                  className="input"
                  disabled={creatingShift}
                  required
                >
                  <option value="">Select role</option>
                  <option value="HCA">Healthcare Assistant (HCA)</option>
                  <option value="Support Worker">Support Worker</option>
                  <option value="Nurse">Nurse</option>
                  <option value="RGN">Registered Nurse (RGN)</option>
                  <option value="RMN">Mental Health Nurse (RMN)</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Shift location
                </label>

                <input
                  type="text"
                  name="location"
                  value={createShiftForm.location}
                  onChange={handleCreateShiftChange}
                  className="input"
                  placeholder="Care home, hospital or service name"
                  disabled={creatingShift}
                  required
                />
              </div>

              <div className="md:col-span-2 lg:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Address
                </label>

                <input
                  type="text"
                  name="address"
                  value={createShiftForm.address}
                  onChange={handleCreateShiftChange}
                  className="input"
                  placeholder="Shift address"
                  disabled={creatingShift}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Postcode
                </label>

                <input
                  type="text"
                  name="postcode"
                  value={createShiftForm.postcode}
                  onChange={handleCreateShiftChange}
                  className="input"
                  placeholder="Postcode"
                  disabled={creatingShift}
                />
              </div>

              <div className="md:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Landmarks or access instructions
                </label>

                <textarea
                  name="landmarks"
                  value={createShiftForm.landmarks}
                  onChange={handleCreateShiftChange}
                  className="input min-h-[80px]"
                  placeholder="Parking, entrance, ward, unit or access information"
                  disabled={creatingShift}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Client billing rate (£/hr)
                </label>

                <input
                  type="number"
                  name="clientRate"
                  min="0"
                  step="0.01"
                  value={createShiftForm.clientRate}
                  onChange={handleCreateShiftChange}
                  className="input"
                  placeholder="For example, 25.00"
                  disabled={creatingShift}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Staff pay rate (£/hr)
                </label>

                <input
                  type="number"
                  name="staffRate"
                  min="0"
                  step="0.01"
                  value={createShiftForm.staffRate}
                  onChange={handleCreateShiftChange}
                  className="input"
                  placeholder="For example, 14.50"
                  disabled={creatingShift}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  resetCreateShiftForm();
                  setShowCreateShift(false);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                disabled={creatingShift}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={creatingShift || loadingClients || clients.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingShift && <Loader2 className="h-4 w-4 animate-spin" />}

                {creatingShift ? "Creating shift..." : "Create Shift"}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Filters + sort row */}
      <div className="card flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ListFilter className="h-3.5 w-3.5" />
              <span>Filter</span>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input !text-xs !py-1.5 !h-8 w-44"
            >
              <option value="all">All status</option>
              <option value="open">Open</option>
              <option value="pending_admin">Pending admin</option>
              <option value="client_pending">Client pending</option>
              <option value="booked">Booked</option>
              {/* ✅ ADDED */}
              <option value="completed">Completed</option>
              {/* ✅ ADDED */}
              <option value="null">Null</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <div className="relative flex-1 min-w-[180px]">
              <Users className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                placeholder="Filter by client name / 4-digit ID / email…"
                className="input pl-8 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-500">Sort by</span>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input !text-xs !py-1.5 !h-8 w-36"
            >
              <option value="date">Date</option>
              <option value="period">Period (1–7, 8–14…)</option>
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

            {/* ✅ CSV download button (keeps everything else) */}
            <button
              type="button"
              onClick={downloadCurrentCSV}
              className="btn btn-outline !px-3 !py-1 !text-[11px]"
              title="Download CSV of the current filtered/sorted view"
            >
              Download CSV
            </button>
          </div>
        </div>

        {/* ✅ Period controls (added, non-breaking) */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">Period</span>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="input !text-xs !py-1.5 !h-8 w-44"
            >
              <option value="all">All</option>
              <option value="current">Current period</option>
              <option value="custom">Custom range</option>
            </select>

            {periodFilter === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="input !text-xs !py-1.5 !h-8"
                  aria-label="Period start date"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="input !text-xs !py-1.5 !h-8"
                  aria-label="Period end date"
                />
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-500">
            {activePeriodRange?.label ? (
              <>
                Showing period:{" "}
                <span className="font-semibold text-slate-700">
                  {activePeriodRange.label}
                </span>
              </>
            ) : (
              <>
                Showing:{" "}
                <span className="font-semibold text-slate-700">All dates</span>
              </>
            )}
          </div>
        </div>

        {periodFilter === "custom" && periodStart && periodEnd && !activePeriodRange && (
          <div className="text-[11px] text-rose-700">
            Invalid period range (start must be on/before end).
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shifts…
        </div>
      ) : !filteredAndSorted.length ? (
        <div className="card text-sm text-slate-600">No shifts found.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="uh-admin-shifts-table min-w-full text-xs">
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
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Role
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Rates (£/hr)
                </th>

                {/* ✅ ADDED: Est. bill column */}
                <th className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                  Est. Bill
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
                const isOpen = !!expanded[shift.id];

                const dateObj = shift.date?.toDate ? shift.date.toDate() : null;
                const dateDisplay = dateObj ? dateObj.toLocaleDateString() : "—";
                const dateInput = dateObj ? dateObj.toISOString().slice(0, 10) : "";

                const statusBadge = getStatusBadge(shift.status);
                const paidBadge = getPaidBadge(shift);

                const staffRateNum = toNumberOrNull(readStaffRate(shift));
                const clientRateNum = toNumberOrNull(readClientRate(shift));

                const shiftIdDisplay = getShiftIdDisplay(shift);
                const createdByDisplay = getCreatedByDisplay(shift);
                const staffDisplay = getStaffDisplay(shift);

                const shiftType = getShiftTypeFromStartTime(
                  isEditing ? editForm.startTime || shift.startTime : shift.startTime
                );

                const clientName = getClientName(shift);
                const clientPublicId = getClientPublicId(shift);
                const clientEmail = getClientEmail(shift);

                const rowKey = shift.id || shift.shiftId || `${clientPublicId}-${idx}`;

                const periodLabel = (() => {
                  const d = toDateObj(shift.date) || toDateObj(shift.createdAt) || null;
                  const r = getPeriodRangeForDate(d);
                  return r?.label || "—";
                })();

                const isPaid = readPaidFlag(shift);

                // ✅ Est. bill calc (uses current edit form when editing, otherwise shift times)
                const estStart = isEditing ? editForm.startTime || shift.startTime : shift.startTime;
                const estEnd = isEditing ? editForm.endTime || shift.endTime : shift.endTime;

                const estMins = calcShiftDurationMinutes(estStart, estEnd);
                const estHours = minutesToHours(estMins);
                const estBill =
                  typeof clientRateNum === "number" && typeof estHours === "number"
                    ? clientRateNum * estHours
                    : null;

                return (
                  <Fragment key={rowKey}>
                    {/* MAIN ROW */}
                    <tr
                      className={`border-b border-slate-100 ${idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
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
                          <div className="flex flex-col">
                            <span>{dateDisplay}</span>
                            <span className="text-[10px] text-slate-500">
                              {periodLabel}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Time + day/night */}
                      <td className="px-3 py-2 align-top text-slate-600 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="time"
                              value={editForm.startTime || shift.startTime || ""}
                              onChange={(e) =>
                                handleEditChange("startTime", e.target.value)
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
                          <div className="flex flex-col gap-1">
                            <div>{`${shift.startTime || "?"} – ${shift.endTime || "?"
                              }`}</div>
                            <div className="inline-flex items-center gap-1">
                              {shiftType === "Night" ? (
                                <Moon className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <Sun className="h-3.5 w-3.5 text-slate-400" />
                              )}
                              <span className="text-[10px] font-semibold text-slate-600">
                                {shiftType}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Client */}
                      <td className="px-3 py-2 align-top">
                        <div className="text-slate-900 font-semibold">
                          {clientPublicId
                            ? `${clientName} (${clientPublicId})`
                            : clientName}
                        </div>
                        {clientEmail ? (
                          <a
                            href={`mailto:${clientEmail}`}
                            className="text-[11px] text-cyan-700 hover:underline"
                          >
                            {clientEmail}
                          </a>
                        ) : (
                          <div className="text-[11px] text-slate-400">—</div>
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

                      {/* Rates */}
                      <td className="px-3 py-2 align-top text-slate-700 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={editForm.staffRate ?? ""}
                              onChange={(e) =>
                                handleEditChange("staffRate", e.target.value)
                              }
                              className="input !text-[11px] !py-1 !h-8"
                              placeholder="Staff rate"
                            />
                            <input
                              type="number"
                              inputMode="decimal"
                              value={editForm.clientRate ?? ""}
                              onChange={(e) =>
                                handleEditChange("clientRate", e.target.value)
                              }
                              className="input !text-[11px] !py-1 !h-8"
                              placeholder="Client billing rate"
                            />
                            <div className="text-[10px] text-slate-500">
                              Staff rate affects staff pay. Client rate affects
                              billing only.
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-slate-600">
                              Staff:{" "}
                              <span className="font-semibold text-slate-900">
                                {typeof staffRateNum === "number"
                                  ? `£${staffRateNum.toFixed(2)}`
                                  : "—"}
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-600">
                              Client (Billing):{" "}
                              <span className="font-semibold text-slate-900">
                                {typeof clientRateNum === "number"
                                  ? `£${clientRateNum.toFixed(2)}`
                                  : "—"}
                              </span>
                            </span>
                          </div>
                        )}
                      </td>

                      {/* ✅ ADDED: Est. Bill (per shift) */}
                      <td className="px-3 py-2 align-top text-slate-700 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-slate-900">
                            {formatMoneyGBP(estBill)}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            Hours:{" "}
                            <span className="font-semibold text-slate-700">
                              {typeof estHours === "number" ? estHours.toFixed(2) : "—"}
                            </span>
                          </span>
                        </div>
                      </td>

                      {/* Status + Paid badge */}
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.className}`}
                          >
                            {statusBadge.label}
                          </span>

                          {paidBadge && (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${paidBadge.className}`}
                              title="Invoice settled"
                            >
                              {paidBadge.label}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions + View details */}
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(shift.id)}
                            className="btn btn-outline !px-3 !py-1 !text-[11px]"
                          >
                            {isOpen ? "Hide details" : "View details"}
                          </button>

                          {canMutateAnyShift && (
                            <>

                          {/* ✅ Paid toggle (does not replace any existing actions) */}
                          {!isEditing && (
                            <>
                              {isPaid ? (
                                <button
                                  type="button"
                                  onClick={() => setPaidStatus(shift, false)}
                                  disabled={savingId === shift.id}
                                  className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                                  title="Mark as not paid"
                                >
                                  {savingId === shift.id ? "Updating…" : "Unpaid"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPaidStatus(shift, true)}
                                  disabled={savingId === shift.id}
                                  className="btn !px-3 !py-1 !text-[11px] bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
                                  title="Mark as paid"
                                >
                                  {savingId === shift.id ? "Updating…" : "Mark paid"}
                                </button>
                              )}
                            </>
                          )}

                          {!isEditing &&
                            (shift.status || "").toLowerCase() ===
                            "pending_admin" && (
                              <button
                                type="button"
                                onClick={() => approveStaffBooking(shift)}
                                disabled={savingId === shift.id}
                                className="btn !px-3 !py-1 !text-[11px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                              >
                                {savingId === shift.id
                                  ? "Approving…"
                                  : "Approve staff booking"}
                              </button>
                            )}

                          {(shift.status === "client_pending" ||
                            shift.status === "pending") &&
                            !isEditing && (
                              <button
                                type="button"
                                onClick={() => updateShiftStatus(shift, "open")}
                                disabled={savingId === shift.id}
                                className="btn !px-3 !py-1 !text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {savingId === shift.id
                                  ? "Approving…"
                                  : "Approve client shift"}
                              </button>
                            )}

                          {!isEditing &&
                            shift.status !== "open" &&
                            shift.status !== "cancelled" && (
                              <button
                                type="button"
                                onClick={() => updateShiftStatus(shift, "open")}
                                disabled={savingId === shift.id}
                                className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                              >
                                Set open
                              </button>
                            )}

                          {!isEditing &&
                            (shift.status || "").toLowerCase() === "open" && (
                              <button
                                type="button"
                                onClick={() => openAssignStaff(shift)}
                                disabled={
                                  savingId === shift.id || assigningStaff
                                }
                                className="btn btn-outline !px-3 !py-1 !text-[11px] border-cyan-300 text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                              >
                                Assign Staff
                              </button>
                            )}
                          {/* ✅ ADDED: allow manual status change to completed/null if needed */}
                          {!isEditing &&
                            shift.status !== "completed" &&
                            shift.status !== "cancelled" && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateShiftStatus(shift, "completed")
                                }
                                disabled={savingId === shift.id}
                                className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                              >
                                Mark completed
                              </button>
                            )}

                          {!isEditing &&
                            shift.status !== "null" &&
                            shift.status !== "cancelled" && (
                              <button
                                type="button"
                                onClick={() => updateShiftStatus(shift, "null")}
                                disabled={savingId === shift.id}
                                className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                              >
                                Set null
                              </button>
                            )}

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
                        
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* DETAILS ROW (full-width beneath) */}
                    {isOpen && (
                      <tr
                        className={`${idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                          }`}
                      >
                        <td colSpan={8} className="px-3 pb-3">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                              <DetailPill label="Shift ID" value={shiftIdDisplay} />
                              <DetailPill label="Period" value={periodLabel} />
                              <DetailPill label="Created by" value={createdByDisplay} />
                              <DetailPill label="Staff" value={staffDisplay} />
                              <DetailPill label="Location" value={shift.location || "—"} />
                              <DetailPill label="Address" value={shift.address || "—"} />
                              <DetailPill label="Paid" value={isPaid ? "Yes" : "No"} />

                              {/* ✅ ADDED: Est billing visibility in details too */}
                              <DetailPill
                                label="Est. Bill"
                                value={
                                  typeof estBill === "number"
                                    ? `${formatMoneyGBP(estBill)} (hrs ${estHours.toFixed(2)})`
                                    : "—"
                                }
                              />
                            </div>

                            {/* ✅ Keep edit capability for location/address without changing rules */}
                            {isEditing && (
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    Location / Ward *
                                  </label>
                                  <input
                                    type="text"
                                    value={editForm.location || shift.location || ""}
                                    onChange={(e) =>
                                      handleEditChange("location", e.target.value)
                                    }
                                    className="input !text-[11px] !py-1.5 !h-9"
                                    placeholder="Location / Ward"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    Address
                                  </label>
                                  <input
                                    type="text"
                                    value={editForm.address || shift.address || ""}
                                    onChange={(e) =>
                                      handleEditChange("address", e.target.value)
                                    }
                                    className="input !text-[11px] !py-1.5 !h-9"
                                    placeholder="Address"
                                  />
                                </div>
                              </div>
                            )}
                            {assigningShift?.id === shift.id && (
                              <form
                                onSubmit={submitAdminStaffAssignment}
                                className="mt-4 rounded-xl border border-cyan-200 bg-white p-4"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <h4 className="text-sm font-semibold text-slate-900">
                                      Assign Staff to Shift
                                    </h4>

                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {getClientName(shift)} • {shift.role || "Role not recorded"} •{" "}
                                      {shift.startTime || "?"}–{shift.endTime || "?"}
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={closeAssignStaff}
                                    disabled={assigningStaff}
                                    className="btn btn-outline !px-3 !py-1 !text-[11px] disabled:opacity-60"
                                  >
                                    Close
                                  </button>
                                </div>

                                {assignStaffError && (
                                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                    {assignStaffError}
                                  </div>
                                )}

                                <div className="mt-4">
                                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                                    Search active staff
                                  </label>

                                  <input
                                    type="search"
                                    value={staffSearch}
                                    onChange={(event) => {
                                      setStaffSearch(event.target.value);
                                      setSelectedStaffId("");
                                      setAssignStaffError("");
                                    }}
                                    placeholder="Search by name, Staff ID, email or role"
                                    className="input"
                                    disabled={assigningStaff}
                                  />
                                </div>

                                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                                  {loadingStaffMembers ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Loading active staff…
                                    </div>
                                  ) : filteredAssignableStaff.length === 0 ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                                      No active and fully onboarded staff match your search.
                                    </div>
                                  ) : (
                                    filteredAssignableStaff.map((staff) => {
                                      const staffName = getAssignableStaffName(staff);
                                      const staffRole = getAssignableStaffRole(staff);
                                      const staffPublicId =
                                        getAssignableStaffPublicId(staff);
                                      const maxWeeklyHours =
                                        getAssignableStaffMaxHours(staff);

                                      const isSelected =
                                        selectedStaffId === staff.id;

                                      return (
                                        <label
                                          key={staff.id}
                                          className={`block cursor-pointer rounded-xl border p-3 transition ${isSelected
                                            ? "border-cyan-500 bg-cyan-50"
                                            : "border-slate-200 bg-white hover:border-cyan-300 hover:bg-cyan-50/30"
                                            }`}
                                        >
                                          <div className="flex items-start gap-3">
                                            <input
                                              type="radio"
                                              name={`assignedStaff-${shift.id}`}
                                              value={staff.id}
                                              checked={isSelected}
                                              onChange={() => {
                                                setSelectedStaffId(staff.id);
                                                setAssignStaffError("");
                                              }}
                                              disabled={assigningStaff}
                                              className="mt-1"
                                            />

                                            <div className="min-w-0 flex-1">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-semibold text-slate-900">
                                                  {staffName}
                                                </span>

                                                {staffPublicId && (
                                                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                                    ID {staffPublicId}
                                                  </span>
                                                )}
                                              </div>

                                              <div className="mt-1 text-[11px] text-slate-600">
                                                Role:{" "}
                                                <span className="font-semibold text-slate-800">
                                                  {staffRole}
                                                </span>
                                              </div>

                                              {staff.email && (
                                                <div className="mt-0.5 break-all text-[11px] text-slate-500">
                                                  {staff.email}
                                                </div>
                                              )}

                                              <div className="mt-1 text-[10px] text-slate-500">
                                                {typeof maxWeeklyHours === "number"
                                                  ? `Weekly limit: ${maxWeeklyHours} hours`
                                                  : "No weekly-hours restriction recorded"}
                                              </div>
                                            </div>

                                            {isSelected && (
                                              <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan-600" />
                                            )}
                                          </div>
                                        </label>
                                      );
                                    })
                                  )}
                                </div>

                                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                  The system will verify role compatibility, overlapping
                                  shifts, the 10-hour rest rule and weekly-hours limits
                                  before completing the assignment.
                                </div>

                                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                                  <button
                                    type="button"
                                    onClick={closeAssignStaff}
                                    disabled={assigningStaff}
                                    className="btn btn-outline !px-4 !py-2 !text-xs disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>

                                  <button
                                    type="submit"
                                    disabled={
                                      assigningStaff ||
                                      loadingStaffMembers ||
                                      !selectedStaffId
                                    }
                                    className="btn inline-flex items-center gap-2 !px-4 !py-2 !text-xs bg-cyan-700 text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {assigningStaff && (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    )}

                                    {assigningStaff
                                      ? "Assigning staff…"
                                      : "Assign Selected Staff"}
                                  </button>
                                </div>
                              </form>
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
  );
}
