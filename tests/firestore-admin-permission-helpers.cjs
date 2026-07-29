"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require(
  "@firebase/rules-unit-testing"
);

const {
  doc,
  getDoc,
  setDoc,
} = require(
  "firebase/firestore"
);

const model =
  require(
    require("node:path").resolve(
      process.cwd(),
      "functions",
      "adminAuthorization.js"
    )
  );

const ADMIN_PRESETS =
  model.ADMIN_PRESETS;

const assignablePresets =
  Array.isArray(
    model
      .ASSIGNABLE_PRESET_VALUES
  )
    ? [
        ...model
          .ASSIGNABLE_PRESET_VALUES,
      ]
    : Object
        .keys(
          ADMIN_PRESETS
        )
        .filter(
          (
            preset
          ) =>
            preset !==
              "super_admin"
        );

const probeRulesPath =
  process.env
    .FIRESTORE_PROBE_RULES_PATH;

if (
  !probeRulesPath
) {
  throw new Error(
    "FIRESTORE_PROBE_RULES_PATH was not supplied."
  );
}

const rules =
  fs.readFileSync(
    probeRulesPath,
    "utf8"
  );

const projectId =
  "unity-healthcare-staffing-admin-rule-helper-test";

const assignedClientId =
  "client-assigned";

const otherClientId =
  "client-other";

let environment = null;

let passed = 0;
let failed = 0;

function clone(
  value
) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function isPlainObject(
  value
) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function flattenPermissions(
  value,
  prefix = [],
  output = []
) {
  if (
    typeof value ===
      "string" ||
    typeof value ===
      "boolean"
  ) {
    output.push({
      path: prefix,
      value,
    });

    return output;
  }

  if (
    !isPlainObject(value)
  ) {
    return output;
  }

  for (
    const [
      key,
      nestedValue,
    ] of Object.entries(value)
  ) {
    flattenPermissions(
      nestedValue,
      [
        ...prefix,
        key,
      ],
      output
    );
  }

  return output;
}

function coordinates(
  permissionPath
) {
  if (
    permissionPath.length ===
      1
  ) {
    return {
      area:
        permissionPath[0],

      action:
        "",
    };
  }

  if (
    permissionPath.length ===
      2
  ) {
    return {
      area:
        permissionPath[0],

      action:
        permissionPath[1],
    };
  }

  throw new Error(
    `Unsupported permission path: ${permissionPath.join(".")}`
  );
}

function safePart(
  value
) {
  return String(value)
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    )
    .slice(
      0,
      80
    );
}

function probeId(
  kind,
  area = "",
  action = "",
  clientId = ""
) {
  return [
    kind,
    safePart(area),
    safePart(action || "root"),
    safePart(clientId || "none"),
  ].join("--");
}

function probeCollection(
  kind
) {
  if (
    kind === "active"
  ) {
    return "__adminPermissionProbeActive";
  }

  if (
    kind === "scope"
  ) {
    return "__adminPermissionProbeScope";
  }

  if (
    kind === "boolean"
  ) {
    return "__adminPermissionProbeBoolean";
  }

  throw new Error(
    `Unsupported probe kind: ${kind}`
  );
}

function probeRef(
  database,
  kind,
  area = "",
  action = "",
  clientId = ""
) {
  return doc(
    database,
    probeCollection(
      kind
    ),
    probeId(
      kind,
      area,
      action,
      clientId
    )
  );
}
async function runCheck(
  name,
  callback
) {
  try {
    await callback();

    passed += 1;

    console.log(
      `PASS ${String(
        passed
      ).padStart(
        3,
        "0"
      )}: ${name}`
    );
  } catch (error) {
    failed += 1;

    console.error("");
    console.error(
      `FAIL: ${name}`
    );

    console.error(
      error?.message ||
      error
    );

    console.error("");
  }
}

function fullEscalationPermissions() {
  const permissions =
    clone(
      ADMIN_PRESETS
        .super_admin
        .permissions
    );

  permissions.adminManagement =
    true;

  return permissions;
}

function customPermissionData() {
  const permissions =
    clone(
      ADMIN_PRESETS
        .custom
        .permissions
    );

  permissions.clients.view =
    "assigned";

  permissions.clients.edit =
    "none";

  permissions.shifts.view =
    "all";

  permissions.shifts.create =
    "assigned";

  permissions.shifts.edit =
    "none";

  permissions.shifts.assign =
    "none";

  permissions.shifts.cancel =
    "none";

  permissions.staffPortalAccess =
    true;

  permissions.users.view =
    true;

  permissions
    .staffApplications
    .view =
      true;

  permissions
    .staffApplications
    .manage =
      false;

  permissions.timesheets.view =
    true;

  permissions.timesheets.manage =
    false;

  permissions.invoices.view =
    true;

  permissions.invoices.manage =
    false;

  permissions.payroll.view =
    true;

  permissions.payroll.manage =
    false;

  /*
   * Deliberate escalation attempt.
   * The rules helper must always deny this.
   */
  permissions.adminManagement =
    true;

  return permissions;
}

function expectedCustomPermissions(
  storedPermissions
) {
  const expected =
    clone(
      storedPermissions
    );

  expected.adminManagement =
    false;

  return expected;
}

function adminProfile({
  uid,
  email,
  preset,
  permissions,
  assignedClientIds = [
    assignedClientId,
  ],
  enabled = true,
  active = true,
  isActive = true,
  status = "active",
}) {
  return {
    uid,
    email,
    role:
      "admin",
    accountType:
      "admin",
    isAdmin:
      true,
    isActive,
    status,

    adminAccess: {
      version: 1,
      enabled,
      active,
      preset,
      assignedClientIds,
      permissions,
    },
  };
}

function permissionKey(
  leaf
) {
  return `${typeof leaf.value}:${leaf.path.join(".")}`;
}

async function seedData(
  profiles,
  permissionLeaves
) {
  await environment
    .withSecurityRulesDisabled(
      async (
        context
      ) => {
        const database =
          context.firestore();

        await setDoc(
          probeRef(
            database,
            "active"
          ),
          {
            kind:
              "active",
          }
        );

        const uniqueLeaves =
          new Map();

        for (
          const leaf of
          permissionLeaves
        ) {
          uniqueLeaves.set(
            permissionKey(
              leaf
            ),
            leaf
          );
        }

        for (
          const leaf of
          uniqueLeaves.values()
        ) {
          const {
            area,
            action,
          } =
            coordinates(
              leaf.path
            );

          if (
            typeof leaf.value ===
              "string"
          ) {
            for (
              const clientId of [
                assignedClientId,
                otherClientId,
              ]
            ) {
              await setDoc(
                probeRef(
                  database,
                  "scope",
                  area,
                  action,
                  clientId
                ),
                {
                  kind:
                    "scope",
                  area,
                  action,
                  clientId,
                }
              );
            }

            continue;
          }

          await setDoc(
            probeRef(
              database,
              "boolean",
              area,
              action
            ),
            {
              kind:
                "boolean",
              area,
              action,
            }
          );
        }

        for (
          const profile of
          profiles
        ) {
          await setDoc(
            doc(
              database,
              "users",
              profile.uid
            ),
            profile.data
          );
        }
      }
    );
}

async function verifyPermissionMatrix(
  database,
  preset,
  permissions
) {
  const leaves =
    flattenPermissions(
      permissions
    );

  for (
    const leaf of
    leaves
  ) {
    const {
      area,
      action,
    } =
      coordinates(
        leaf.path
      );

    const label =
      `${preset}.${leaf.path.join(".")}`;

    if (
      typeof leaf.value ===
        "string"
    ) {
      if (
        leaf.value === "all"
      ) {
        await runCheck(
          `${label} allows assigned client`,
          () =>
            assertSucceeds(
              getDoc(
                probeRef(
                  database,
                  "scope",
                  area,
                  action,
                  assignedClientId
                )
              )
            )
        );

        await runCheck(
          `${label} allows other client`,
          () =>
            assertSucceeds(
              getDoc(
                probeRef(
                  database,
                  "scope",
                  area,
                  action,
                  otherClientId
                )
              )
            )
        );

        continue;
      }

      if (
        leaf.value ===
          "assigned"
      ) {
        await runCheck(
          `${label} allows assigned client`,
          () =>
            assertSucceeds(
              getDoc(
                probeRef(
                  database,
                  "scope",
                  area,
                  action,
                  assignedClientId
                )
              )
            )
        );

        await runCheck(
          `${label} rejects other client`,
          () =>
            assertFails(
              getDoc(
                probeRef(
                  database,
                  "scope",
                  area,
                  action,
                  otherClientId
                )
              )
            )
        );

        continue;
      }

      await runCheck(
        `${label} rejects access`,
        () =>
          assertFails(
            getDoc(
              probeRef(
                database,
                "scope",
                area,
                action,
                assignedClientId
              )
            )
          )
      );

      continue;
    }

    await runCheck(
      `${label} is ${leaf.value}`,
      () =>
        leaf.value === true
          ? assertSucceeds(
              getDoc(
                probeRef(
                  database,
                  "boolean",
                  area,
                  action
                )
              )
            )
          : assertFails(
              getDoc(
                probeRef(
                  database,
                  "boolean",
                  area,
                  action
                )
              )
            )
    );
  }
}

async function main() {
  if (
    !rules.includes(
      "BEGIN GENERATED STRUCTURED ADMIN HELPERS"
    ) ||
    !rules.includes(
      "match /__adminPermissionProbe/"
    )
  ) {
    throw new Error(
      "Probe rules do not contain the required helper and probe blocks."
    );
  }

  environment =
    await initializeTestEnvironment({
      projectId,

      firestore: {
        host:
          "127.0.0.1",

        port:
          8080,

        rules,
      },
    });

  const storedCustomPermissions =
    customPermissionData();

  const expectedCustom =
    expectedCustomPermissions(
      storedCustomPermissions
    );

  const profiles = [];

  const permissionLeaves = [];

  for (
    const preset of
    assignablePresets
  ) {
    const uid =
      `admin-${preset}`;

    const email =
      `${preset.replace(
        /_/g,
        "."
      )}@example.test`;

    const permissions =
      preset === "custom"
        ? storedCustomPermissions
        : fullEscalationPermissions();

    profiles.push({
      uid,
      email,
      preset,

      data:
        adminProfile({
          uid,
          email,
          preset,
          permissions,
        }),

      expected:
        preset === "custom"
          ? expectedCustom
          : ADMIN_PRESETS[
              preset
            ].permissions,
    });

    permissionLeaves.push(
      ...flattenPermissions(
        preset === "custom"
          ? expectedCustom
          : ADMIN_PRESETS[
              preset
            ].permissions
      )
    );
  }

  profiles.push({
    uid:
      "disabled-admin",

    email:
      "disabled.admin@example.test",

    data:
      adminProfile({
        uid:
          "disabled-admin",

        email:
          "disabled.admin@example.test",

        preset:
          "operations_admin",

        permissions:
          fullEscalationPermissions(),

        isActive:
          false,
      }),
  });

  profiles.push({
    uid:
      "inactive-access-admin",

    email:
      "inactive.access@example.test",

    data:
      adminProfile({
        uid:
          "inactive-access-admin",

        email:
          "inactive.access@example.test",

        preset:
          "operations_admin",

        permissions:
          fullEscalationPermissions(),

        active:
          false,
      }),
  });

  profiles.push({
    uid:
      "legacy-admin",

    email:
      "legacy.admin@example.test",

    data: {
      uid:
        "legacy-admin",

      email:
        "legacy.admin@example.test",

      role:
        "admin",

      accountType:
        "admin",

      isAdmin:
        true,

      isActive:
        true,

      status:
        "active",
    },
  });

  profiles.push({
    uid:
      "structured-super-admin",

    email:
      "structured.super@example.test",

    data:
      adminProfile({
        uid:
          "structured-super-admin",

        email:
          "structured.super@example.test",

        preset:
          "super_admin",

        permissions:
          fullEscalationPermissions(),
      }),
  });

  profiles.push({
    uid:
      "unverified-admin",

    email:
      "unverified.admin@example.test",

    data:
      adminProfile({
        uid:
          "unverified-admin",

        email:
          "unverified.admin@example.test",

        preset:
          "operations_admin",

        permissions:
          fullEscalationPermissions(),
      }),
  });

  await seedData(
    profiles,
    permissionLeaves
  );

  for (
    const profile of
    profiles.filter(
      (
        entry
      ) =>
        entry.expected
    )
  ) {
    const context =
      environment
        .authenticatedContext(
          profile.uid,
          {
            email:
              profile.email,

            email_verified:
              true,
          }
        );

    const database =
      context.firestore();

    await runCheck(
      `${profile.preset} resolves as an active structured administrator`,
      () =>
        assertSucceeds(
          getDoc(
            probeRef(
              database,
              "active"
            )
          )
        )
    );

    await verifyPermissionMatrix(
      database,
      profile.preset,
      profile.expected
    );
  }

  for (
    const deniedProfile of
    profiles.filter(
      (
        entry
      ) =>
        !entry.expected &&
        entry.uid !==
          "unverified-admin"
    )
  ) {
    const context =
      environment
        .authenticatedContext(
          deniedProfile.uid,
          {
            email:
              deniedProfile.email,

            email_verified:
              true,
          }
        );

    await runCheck(
      `${deniedProfile.uid} is not accepted as structured administrator`,
      () =>
        assertFails(
          getDoc(
            probeRef(
              context.firestore(),
              "active"
            )
          )
        )
    );
  }

  const unverifiedContext =
    environment
      .authenticatedContext(
        "unverified-admin",
        {
          email:
            "unverified.admin@example.test",

          email_verified:
            false,
        }
      );

  await runCheck(
    "unverified structured administrator is rejected",
    () =>
      assertFails(
        getDoc(
          probeRef(
            unverifiedContext
              .firestore(),
            "active"
          )
        )
      )
  );

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "FIRESTORE ADMIN HELPER TEST RESULTS"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Passed: ${passed}`
  );

  console.log(
    `Failed: ${failed}`
  );

  console.log(
    `Total:  ${passed + failed}`
  );

  console.log(
    "========================================"
  );

  if (
    failed > 0
  ) {
    process.exitCode =
      1;

    return;
  }

  console.log("");
  console.log(
    "SUCCESS: The Firestore helper matrix matches the backend presets."
  );

  console.log(
    "SUCCESS: Standard presets ignore stored permission escalation."
  );

  console.log(
    "SUCCESS: Custom adminManagement escalation is rejected."
  );

  console.log(
    "SUCCESS: Assigned and all-client scopes were distinguished."
  );

  console.log(
    "SUCCESS: Disabled, legacy, unverified and structured super_admin profiles were rejected."
  );
}

main()
  .catch(
    (
      error
    ) => {
      console.error("");
      console.error(
        "FATAL HELPER TEST ERROR:"
      );

      console.error(
        error?.stack ||
        error
      );

      process.exitCode =
        1;
    }
  )
  .finally(
    async () => {
      if (
        environment
      ) {
        await environment
          .cleanup();
      }
    }
  );