import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebaseConfig";
import {
  ADMIN_PRESETS,
  DEFAULT_ADMIN_PERMISSIONS,
  SUPER_ADMIN_EMAILS,
} from "../utils/adminAccess";

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function getUserName(user) {
  return (
    user.fullName ||
    user.name ||
    user.displayName ||
    user.organisationName ||
    user.email ||
    "Unnamed user"
  );
}

function getClientName(client) {
  return (
    client.organisationName ||
    client.tradingName ||
    client.contact?.name ||
    client.contactName ||
    client.email ||
    "Unnamed client"
  );
}

function getClientCode(client) {
  const value = cleanText(
    client.clientCode || client.publicId || ""
  );

  return value ? value.padStart(4, "0") : "";
}

function isProtectedSuperAdmin(user) {
  return SUPER_ADMIN_EMAILS.includes(
    cleanEmail(user?.email)
  );
}

function isAdministrator(user) {
  const role = cleanText(
    user?.role || user?.accountType
  ).toLowerCase();

  return (
    isProtectedSuperAdmin(user) ||
    role === "admin" ||
    user?.isAdmin === true ||
    user?.adminAccess?.enabled === true
  );
}

function getPresetLabel(user) {
  if (isProtectedSuperAdmin(user)) {
    return ADMIN_PRESETS.super_admin.label;
  }

  const presetKey = user?.adminAccess?.preset;

  if (ADMIN_PRESETS[presetKey]) {
    return ADMIN_PRESETS[presetKey].label;
  }

  if (isAdministrator(user)) {
    return "Legacy Full Admin";
  }

  return "No Admin Access";
}

function buildCustomPermissions(value) {
  const source =
    value && typeof value === "object"
      ? value
      : {};

  return {
    clients: {
      ...DEFAULT_ADMIN_PERMISSIONS.clients,
      ...(source.clients || {}),
    },
    shifts: {
      ...DEFAULT_ADMIN_PERMISSIONS.shifts,
      ...(source.shifts || {}),
    },
    staffPortalAccess:
      source.staffPortalAccess ??
      DEFAULT_ADMIN_PERMISSIONS.staffPortalAccess,
    users: {
      ...DEFAULT_ADMIN_PERMISSIONS.users,
      ...(source.users || {}),
    },
    staffApplications: {
      ...DEFAULT_ADMIN_PERMISSIONS.staffApplications,
      ...(source.staffApplications || {}),
    },
    timesheets: {
      ...DEFAULT_ADMIN_PERMISSIONS.timesheets,
      ...(source.timesheets || {}),
    },
    invoices: {
      ...DEFAULT_ADMIN_PERMISSIONS.invoices,
      ...(source.invoices || {}),
    },
    payroll: {
      ...DEFAULT_ADMIN_PERMISSIONS.payroll,
      ...(source.payroll || {}),
    },

    // Only protected Super Admin accounts may manage access.
    adminManagement: false,
  };
}

function customPermissionsRequireAssignments(value) {
  const permissions =
    buildCustomPermissions(value);

  const scopeSections = [
    permissions.clients,
    permissions.shifts,
    permissions.timesheets,
    permissions.invoices,
  ];

  return scopeSections.some(
    (section) =>
      Object.values(section).includes(
        "assigned"
      )
  );
}
const scopeOptions = [
  { value: "none", label: "None" },
  { value: "assigned", label: "Assigned clients" },
  { value: "all", label: "All clients" },
];

function ScopeSelect({
  label,
  value,
  onChange,
  disabled = false,
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] font-medium text-slate-600">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        disabled={disabled}
        className="input w-full !py-1.5 !text-xs disabled:bg-slate-100 disabled:text-slate-500"
      >
        {scopeOptions.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BooleanPermission({
  label,
  checked,
  onChange,
  disabled = false,
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          onChange(event.target.checked)
        }
        disabled={disabled}
        className="h-4 w-4"
      />

      <span>{label}</span>
    </label>
  );
}

export default function AdminAccessManagement({
  currentUser,
}) {
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [inventory, setInventory] = useState(null);
  const [inventoryLoading, setInventoryLoading] =
    useState(false);
  const [inventoryError, setInventoryError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [showOnlyAdmins, setShowOnlyAdmins] =
    useState(true);

  const [selectedUserId, setSelectedUserId] =
    useState("");

  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState(true);
  const [preset, setPreset] =
    useState("operations_admin");

  const [assignedClientIds, setAssignedClientIds] =
    useState([]);

  const [customPermissions, setCustomPermissions] =
    useState(() =>
      buildCustomPermissions(
        DEFAULT_ADMIN_PERMISSIONS
      )
    );

  const loadInventory = async () => {
    setInventoryLoading(true);
    setInventoryError("");

    try {
      const getAdminAccessInventory =
        httpsCallable(
          functions,
          "getAdminAccessInventoryV2"
        );

      const response =
        await getAdminAccessInventory({});

      if (response?.data?.ok !== true) {
        throw new Error(
          "The server did not return a valid administrator inventory."
        );
      }

      setInventory(response.data);
    } catch (inventoryLoadError) {
      console.error(
        "Could not load administrator inventory:",
        inventoryLoadError
      );

      setInventory(null);

      setInventoryError(
        "Could not load the administrator inventory. No data was changed."
      );
    } finally {
      setInventoryLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [usersSnapshot, clientsSnapshot] =
        await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "clients")),
        ]);

      const loadedUsers = usersSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

      /*
       * A protected Super Admin can be authorised by
       * the application even when their users document
       * is missing or does not contain an email field.
       *
       * Add local read-only representations so every
       * protected account appears on this management page.
       */
      const currentEmail = cleanEmail(
        currentUser?.email
      );

      const currentUid = cleanText(
        currentUser?.uid
      );

      if (currentUid && currentEmail) {
        const currentUserIndex =
          loadedUsers.findIndex(
            (user) => user.id === currentUid
          );

        if (currentUserIndex >= 0) {
          loadedUsers[currentUserIndex] = {
            ...loadedUsers[currentUserIndex],
            uid:
              loadedUsers[currentUserIndex].uid ||
              currentUid,
            email:
              loadedUsers[currentUserIndex].email ||
              currentEmail,
          };
        }
      }

      for (const protectedEmail of
        SUPER_ADMIN_EMAILS) {
        const alreadyPresent = loadedUsers.some(
          (user) =>
            cleanEmail(user.email) ===
            protectedEmail
        );

        if (alreadyPresent) continue;

        const isCurrentProtectedAccount =
          protectedEmail === currentEmail;

        loadedUsers.push({
          id:
            isCurrentProtectedAccount && currentUid
              ? currentUid
              : `protected:${protectedEmail}`,
          uid:
            isCurrentProtectedAccount
              ? currentUid
              : "",
          email: protectedEmail,
          displayName: protectedEmail,
          role: "admin",
          accountType: "admin",
          isAdmin: true,
          isActive: true,
          status: "active",
          adminAccess: {
            version: 1,
            enabled: true,
            active: true,
            preset: "super_admin",
            assignedClientIds: [],
            permissions: {},
          },
          protectedPlaceholder: true,
        });
      }

      const loadedClients =
        clientsSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

      loadedUsers.sort((a, b) =>
        getUserName(a).localeCompare(
          getUserName(b),
          "en-GB"
        )
      );

      loadedClients.sort((a, b) =>
        getClientName(a).localeCompare(
          getClientName(b),
          "en-GB"
        )
      );

      setUsers(loadedUsers);
      setClients(loadedClients);
    } catch (loadError) {
      console.error(
        "Could not load administrator access data:",
        loadError
      );

      setError(
        "Could not load users and clients. Please refresh and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const visibleUsers = useMemo(() => {
    const term = cleanText(searchTerm).toLowerCase();

    return users.filter((user) => {
      if (
        showOnlyAdmins &&
        !isAdministrator(user)
      ) {
        return false;
      }

      if (!term) return true;

      const searchValue = [
        getUserName(user),
        user.email,
        user.role,
        user.accountType,
        getPresetLabel(user),
      ]
        .map((value) =>
          cleanText(value).toLowerCase()
        )
        .join(" ");

      return searchValue.includes(term);
    });
  }, [users, searchTerm, showOnlyAdmins]);

  const selectedUser = useMemo(
    () =>
      users.find(
        (user) => user.id === selectedUserId
      ) || null,
    [users, selectedUserId]
  );

  const selectedIsProtected =
    isProtectedSuperAdmin(selectedUser);

  const presetRequiresAssignments = [
    "assigned_client_viewer",
    "assigned_client_manager",
    "shift_creator_assigned",
  ].includes(preset);

  const isCustom = preset === "custom";

  const customRequiresAssignments =
    isCustom &&
    customPermissionsRequireAssignments(
      customPermissions
    );

  const requiresAssignedClients =
    presetRequiresAssignments ||
    customRequiresAssignments;
  const selectUser = (user) => {
    setSelectedUserId(user.id);
    setSuccess("");
    setError("");

    if (isProtectedSuperAdmin(user)) {
      setEnabled(true);
      setActive(true);
      setPreset("super_admin");
      setAssignedClientIds([]);
      setCustomPermissions(
        buildCustomPermissions(
          ADMIN_PRESETS.super_admin.permissions
        )
      );
      return;
    }

    const storedAccess =
      user.adminAccess &&
      typeof user.adminAccess === "object"
        ? user.adminAccess
        : {};

    const existingPreset =
      ADMIN_PRESETS[storedAccess.preset]
        ? storedAccess.preset
        : isAdministrator(user)
          ? "operations_admin"
          : "staff_portal_only";

    setEnabled(
      storedAccess.enabled ??
        isAdministrator(user)
    );

    setActive(
      storedAccess.active ??
        user.isActive !== false
    );

    setPreset(existingPreset);

    setAssignedClientIds(
      Array.isArray(
        storedAccess.assignedClientIds
      )
        ? [...new Set(
            storedAccess.assignedClientIds
              .map(cleanText)
              .filter(Boolean)
          )]
        : []
    );

    setCustomPermissions(
      buildCustomPermissions(
        storedAccess.permissions
      )
    );
  };

  const toggleAssignedClient = (clientId) => {
    setAssignedClientIds((current) =>
      current.includes(clientId)
        ? current.filter(
            (value) => value !== clientId
          )
        : [...current, clientId]
    );
  };

  const updateCustomScope = (
    section,
    permission,
    value
  ) => {
    setCustomPermissions((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [permission]: value,
      },
    }));
  };

  const updateCustomBoolean = (
    section,
    permission,
    value
  ) => {
    setCustomPermissions((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [permission]: value,
      },
    }));
  };

  const saveAccess = async () => {
    if (!selectedUser) return;

    if (selectedIsProtected) {
      setError(
        "Protected Super Admin accounts cannot be changed."
      );
      return;
    }

    if (
      enabled &&
      requiresAssignedClients &&
      assignedClientIds.length === 0
    ) {
      setError(
        "Select at least one client for this access configuration."
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const manageAdminAccess =
        httpsCallable(
          functions,
          "manageAdminAccessV2"
        );

      const response =
        await manageAdminAccess({
          action: "save",
          targetUid: selectedUser.id,
          enabled,
          active,
          preset,
          assignedClientIds:
            requiresAssignedClients
              ? assignedClientIds
              : [],
          permissions: isCustom
            ? buildCustomPermissions(
                customPermissions
              )
            : {},
        });

      if (response?.data?.ok !== true) {
        throw new Error(
          "The server did not confirm the access update."
        );
      }

      setSuccess(
        response?.data?.message ||
          `Access settings saved for ${getUserName(
            selectedUser
          )}.`
      );

      await loadData();
    } catch (saveError) {
      console.error(
        "Could not save administrator access:",
        saveError
      );

      setError(
        "Could not save access settings. No confirmed change was recorded."
      );
    } finally {
      setSaving(false);
    }
  };

  const disableAccess = async () => {
    if (
      !selectedUser ||
      selectedIsProtected
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Disable administrator access for ${getUserName(
        selectedUser
      )}?`
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const manageAdminAccess =
        httpsCallable(
          functions,
          "manageAdminAccessV2"
        );

      const response =
        await manageAdminAccess({
          action: "disable",
          targetUid: selectedUser.id,
        });

      if (response?.data?.ok !== true) {
        throw new Error(
          "The server did not confirm that access was disabled."
        );
      }

      setEnabled(false);
      setActive(false);

      setSuccess(
        response?.data?.message ||
          `Administrator access disabled for ${getUserName(
            selectedUser
          )}.`
      );

      await loadData();
    } catch (disableError) {
      console.error(
        "Could not disable administrator access:",
        disableError
      );

      setError(
        "Could not disable access. No confirmed change was recorded."
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Admin Access
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Assign administrator presets, client
          restrictions and staff-portal access.
          Protected Super Admin accounts remain
          unrestricted.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {isProtectedSuperAdmin(currentUser) && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                Administrator inventory
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                Read-only review of protected, structured, legacy,
                disabled and invalid administrator profiles.
              </p>
            </div>

            <button
              type="button"
              onClick={loadInventory}
              disabled={inventoryLoading || saving}
              className="btn btn-outline disabled:opacity-60"
            >
              {inventoryLoading
                ? "Loading inventory?"
                : inventory
                  ? "Refresh inventory"
                  : "Load inventory"}
            </button>
          </div>

          {inventoryError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {inventoryError}
            </div>
          )}

          {!inventory && !inventoryError && (
            <p className="text-xs text-slate-500">
              Inventory is loaded only when requested. Loading it
              does not modify any user or administrator record.
            </p>
          )}

          {inventory && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    Users scanned
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {inventory.scannedUserCount ?? 0}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    Administrator profiles
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {inventory.administratorCount ?? 0}
                  </p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-700">
                    Migration review required
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-900">
                    {inventory.migrationRequiredCount ?? 0}
                  </p>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs text-red-700">
                    Blocked by scoped rules
                  </p>
                  <p className="mt-1 text-xl font-semibold text-red-900">
                    {inventory.blockedByStructuredRulesCount ?? 0}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(inventory.counts || {}).map(
                  ([category, categoryCount]) => (
                    <div
                      key={category}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <p className="text-[11px] capitalize text-slate-500">
                        {category.replaceAll("_", " ")}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {categoryCount}
                      </p>
                    </div>
                  )
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Administrator review list
                  </h4>
                  <p className="text-xs text-slate-500">
                    Read-only results
                  </p>
                </div>

                {Array.isArray(inventory.administrators) &&
                inventory.administrators.length > 0 ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {inventory.administrators.map(
                      (administrator) => (
                        <div
                          key={
                            administrator.uid ||
                            administrator.email
                          }
                          className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {administrator.name ||
                                  administrator.email ||
                                  administrator.uid ||
                                  "Unnamed administrator"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {administrator.email ||
                                  "No email"}
                              </p>
                            </div>

                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] capitalize text-slate-700">
                              {cleanText(
                                administrator.category
                              ).replaceAll("_", " ") ||
                                "unknown"}
                            </span>
                          </div>

                          {administrator.recommendedAction &&
                            administrator.recommendedAction !== "none" && (
                              <p className="mt-2 text-xs text-amber-700">
                                Review action: {cleanText(
                                  administrator.recommendedAction
                                ).replaceAll("_", " ")}
                              </p>
                            )}
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No administrator profiles were returned.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {loading ? (
        <div className="card text-sm text-slate-600">
          Loading users and clients…
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="card space-y-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                User accounts
              </h3>

              <p className="text-xs text-slate-500">
                Select a portal user or protected
                system account.
              </p>
            </div>

            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder="Search name, email or role…"
              className="input w-full text-sm"
            />

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={showOnlyAdmins}
                onChange={(event) =>
                  setShowOnlyAdmins(
                    event.target.checked
                  )
                }
                className="h-4 w-4"
              />

              Show administrators only
            </label>

            <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
              {visibleUsers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                  No matching users.
                </p>
              ) : (
                visibleUsers.map((user) => {
                  const selected =
                    user.id === selectedUserId;

                  const protectedAccount =
                    isProtectedSuperAdmin(user);

                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => selectUser(user)}
                      className={[
                        "w-full rounded-xl border px-3 py-3 text-left transition",
                        selected
                          ? "border-cyan-600 bg-cyan-50"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {getUserName(user)}
                          </p>

                          <p className="truncate text-xs text-slate-500">
                            {user.email || "No email"}
                          </p>
                        </div>

                        {protectedAccount && (
                          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Protected
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                          {getPresetLabel(user)}
                        </span>

                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                          {user.status ||
                            (user.isActive === false
                              ? "Disabled"
                              : "Active")}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="card">
            {!selectedUser ? (
              <div className="flex min-h-[300px] items-center justify-center text-center">
                <div>
                  <p className="font-medium text-slate-800">
                    Select a user
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Their access settings will appear
                    here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {getUserName(selectedUser)}
                    </h3>

                    <p className="text-sm text-slate-500">
                      {selectedUser.email ||
                        "No email address"}
                    </p>
                  </div>

                  {selectedIsProtected && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                      Protected Super Admin
                    </span>
                  )}
                </div>

                {selectedIsProtected ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <h4 className="font-semibold text-amber-900">
                      Unrestricted permanent access
                    </h4>

                    <p className="mt-1 text-sm text-amber-800">
                      This email is protected in the
                      application permission foundation.
                      Its Super Admin access cannot be
                      restricted from this page.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <BooleanPermission
                        label="Administrator access enabled"
                        checked={enabled}
                        onChange={setEnabled}
                      />

                      <BooleanPermission
                        label="Account access active"
                        checked={active}
                        onChange={setActive}
                        disabled={!enabled}
                      />
                    </div>

                    <label className="block space-y-1">
                      <span className="block text-xs font-medium text-slate-700">
                        Access preset
                      </span>

                      <select
                        value={preset}
                        onChange={(event) =>
                          setPreset(event.target.value)
                        }
                        disabled={!enabled}
                        className="input w-full text-sm disabled:bg-slate-100"
                      >
                        {Object.entries(
                          ADMIN_PRESETS
                        )
                          .filter(
                            ([key]) =>
                              key !== "super_admin"
                          )
                          .map(([key, value]) => (
                            <option
                              key={key}
                              value={key}
                            >
                              {value.label}
                            </option>
                          ))}
                      </select>
                    </label>

                    {requiresAssignedClients && (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">
                            Assigned clients
                          </h4>

                          <p className="text-xs text-slate-500">
                            Select the clients this
                            administrator may access.
                          </p>
                        </div>

                        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                          {clients.length === 0 ? (
                            <p className="px-2 py-3 text-xs text-slate-500">
                              No client records found.
                            </p>
                          ) : (
                            clients.map((client) => (
                              <label
                                key={client.id}
                                className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={assignedClientIds.includes(
                                    client.id
                                  )}
                                  onChange={() =>
                                    toggleAssignedClient(
                                      client.id
                                    )
                                  }
                                  className="mt-0.5 h-4 w-4"
                                />

                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-slate-800">
                                    {getClientName(
                                      client
                                    )}
                                  </span>

                                  <span className="block truncate text-[11px] text-slate-500">
                                    {getClientCode(
                                      client
                                    )
                                      ? `ID ${getClientCode(
                                          client
                                        )} • `
                                      : ""}
                                    {client.email ||
                                      client.id}
                                  </span>
                                </span>
                              </label>
                            ))
                          )}
                        </div>

                        <p className="text-xs font-medium text-slate-600">
                          Selected:{" "}
                          {assignedClientIds.length}
                        </p>
                      </div>
                    )}

                    {isCustom && (
                      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">
                            Custom permissions
                          </h4>

                          <p className="text-xs text-slate-500">
                            Administrator-access
                            management remains reserved
                            for protected Super Admins.
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <ScopeSelect
                            label="Clients — view"
                            value={
                              customPermissions.clients
                                .view
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "clients",
                                "view",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Clients — edit"
                            value={
                              customPermissions.clients
                                .edit
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "clients",
                                "edit",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Shifts — view"
                            value={
                              customPermissions.shifts
                                .view
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "shifts",
                                "view",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Shifts — create"
                            value={
                              customPermissions.shifts
                                .create
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "shifts",
                                "create",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Shifts — edit"
                            value={
                              customPermissions.shifts
                                .edit
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "shifts",
                                "edit",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Shifts — assign"
                            value={
                              customPermissions.shifts
                                .assign
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "shifts",
                                "assign",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Shifts — cancel"
                            value={
                              customPermissions.shifts
                                .cancel
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "shifts",
                                "cancel",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Timesheets — view"
                            value={
                              customPermissions.timesheets
                                .view
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "timesheets",
                                "view",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Timesheets — approve"
                            value={
                              customPermissions.timesheets
                                .approve
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "timesheets",
                                "approve",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Invoices — view"
                            value={
                              customPermissions.invoices
                                .view
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "invoices",
                                "view",
                                value
                              )
                            }
                          />

                          <ScopeSelect
                            label="Invoices — manage"
                            value={
                              customPermissions.invoices
                                .manage
                            }
                            onChange={(value) =>
                              updateCustomScope(
                                "invoices",
                                "manage",
                                value
                              )
                            }
                          />
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <BooleanPermission
                            label="Staff Portal Access"
                            checked={
                              customPermissions.staffPortalAccess
                            }
                            onChange={(value) =>
                              setCustomPermissions(
                                (current) => ({
                                  ...current,
                                  staffPortalAccess:
                                    value,
                                })
                              )
                            }
                          />

                          <BooleanPermission
                            label="View users"
                            checked={
                              customPermissions.users
                                .view
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "users",
                                "view",
                                value
                              )
                            }
                          />

                          <BooleanPermission
                            label="Manage users"
                            checked={
                              customPermissions.users
                                .manage
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "users",
                                "manage",
                                value
                              )
                            }
                          />

                          <BooleanPermission
                            label="View staff applications"
                            checked={
                              customPermissions
                                .staffApplications.view
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "staffApplications",
                                "view",
                                value
                              )
                            }
                          />

                          <BooleanPermission
                            label="Manage staff applications"
                            checked={
                              customPermissions
                                .staffApplications
                                .manage
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "staffApplications",
                                "manage",
                                value
                              )
                            }
                          />

                          <BooleanPermission
                            label="View payroll"
                            checked={
                              customPermissions.payroll
                                .view
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "payroll",
                                "view",
                                value
                              )
                            }
                          />

                          <BooleanPermission
                            label="Manage payroll"
                            checked={
                              customPermissions.payroll
                                .manage
                            }
                            onChange={(value) =>
                              updateCustomBoolean(
                                "payroll",
                                "manage",
                                value
                              )
                            }
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                      {isAdministrator(
                        selectedUser
                      ) && (
                        <button
                          type="button"
                          onClick={disableAccess}
                          disabled={saving}
                          className="btn btn-outline !border-red-200 !text-red-700 hover:!bg-red-50 disabled:opacity-60"
                        >
                          Disable Admin Access
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={saveAccess}
                        disabled={saving}
                        className="btn btn-primary disabled:opacity-60"
                      >
                        {saving
                          ? "Saving…"
                          : "Save Access"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
