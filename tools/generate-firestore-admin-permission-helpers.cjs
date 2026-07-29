"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const baseRulesPath =
  process.env
    .FIRESTORE_BASE_RULES_PATH;

const outputRulesPath =
  process.env
    .FIRESTORE_OUTPUT_RULES_PATH;

const probeRulesPath =
  process.env
    .FIRESTORE_PROBE_RULES_PATH;

if (
  !baseRulesPath ||
  !outputRulesPath ||
  !probeRulesPath
) {
  throw new Error(
    "Required Firestore candidate paths were not supplied."
  );
}

const model =
  require(
    path.resolve(
      "./functions/adminAuthorization.js"
    )
  );

const ADMIN_PRESETS =
  model.ADMIN_PRESETS;

if (
  !ADMIN_PRESETS ||
  typeof ADMIN_PRESETS !==
    "object"
) {
  throw new Error(
    "ADMIN_PRESETS was not exported."
  );
}

const expectedAssignablePresets = [
  "operations_admin",
  "all_client_viewer",
  "assigned_client_viewer",
  "assigned_client_manager",
  "shift_creator_all",
  "shift_creator_assigned",
  "staff_portal_only",
  "custom",
];

const assignablePresets =
  Array.isArray(
    model.ASSIGNABLE_PRESET_VALUES
  )
    ? [
        ...model.ASSIGNABLE_PRESET_VALUES,
      ]
    : Object
        .keys(
          ADMIN_PRESETS
        )
        .filter(
          (preset) =>
            preset !==
              "super_admin"
        );

if (
  JSON.stringify(
    [...assignablePresets].sort()
  ) !==
  JSON.stringify(
    [...expectedAssignablePresets].sort()
  )
) {
  throw new Error(
    "Assignable preset values do not match the expected eight presets."
  );
}

const standardPresets =
  assignablePresets.filter(
    (preset) =>
      preset !==
        "custom"
  );

function isPlainObject(value) {
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
    typeof value === "string" ||
    typeof value === "boolean"
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

function coordinates(permissionPath) {
  if (
    permissionPath.length === 1
  ) {
    return {
      area:
        permissionPath[0],

      action:
        "",
    };
  }

  if (
    permissionPath.length === 2
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

function safeToken(value) {
  const result =
    String(value || "root")
      .replace(
        /[^a-zA-Z0-9_]/g,
        "_"
      );

  return result ||
    "root";
}

function quote(value) {
  return JSON.stringify(
    String(value)
  );
}

function literal(value) {
  if (
    typeof value ===
      "boolean"
  ) {
    return value
      ? "true"
      : "false";
  }

  return quote(value);
}

function permissionKey(
  area,
  action
) {
  return `${area}\u0000${action}`;
}

function addPermissionValue(
  permissionMap,
  area,
  action,
  preset,
  value
) {
  const key =
    permissionKey(
      area,
      action
    );

  if (
    !permissionMap.has(key)
  ) {
    permissionMap.set(
      key,
      {
        area,
        action,
        values: {},
      }
    );
  }

  permissionMap
    .get(key)
    .values[preset] =
      value;
}

const scopePermissions =
  new Map();

const booleanPermissions =
  new Map();

for (
  const preset of
  standardPresets
) {
  const definition =
    ADMIN_PRESETS[preset];

  if (
    !definition ||
    !isPlainObject(
      definition.permissions
    )
  ) {
    throw new Error(
      `Invalid backend preset: ${preset}`
    );
  }

  const leaves =
    flattenPermissions(
      definition.permissions
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

    if (
      typeof leaf.value ===
        "string"
    ) {
      if (
        ![
          "none",
          "assigned",
          "all",
        ].includes(
          leaf.value
        )
      ) {
        throw new Error(
          `Invalid permission scope: ${preset}.${leaf.path.join(".")}`
        );
      }

      if (
        leaf.value !== "none"
      ) {
        addPermissionValue(
          scopePermissions,
          area,
          action,
          preset,
          leaf.value
        );
      }

      continue;
    }

    if (
      leaf.value === true
    ) {
      addPermissionValue(
        booleanPermissions,
        area,
        action,
        preset,
        true
      );
    }
  }
}

function sortedEntries(permissionMap) {
  return [
    ...permissionMap.values(),
  ].sort(
    (
      left,
      right
    ) =>
      left.area.localeCompare(
        right.area
      ) ||
      left.action.localeCompare(
        right.action
      )
  );
}

function groupByArea(entries) {
  const grouped =
    new Map();

  for (
    const entry of
    entries
  ) {
    if (
      !grouped.has(
        entry.area
      )
    ) {
      grouped.set(
        entry.area,
        []
      );
    }

    grouped
      .get(entry.area)
      .push(entry);
  }

  return grouped;
}

function leafFunctionName(
  type,
  area,
  action
) {
  return [
    "ruleAdmin",
    type,
    safeToken(area),
    safeToken(
      action || "root"
    ),
  ].join("_");
}

function areaFunctionName(
  type,
  area
) {
  return [
    "ruleAdmin",
    type,
    "Area",
    safeToken(area),
  ].join("_");
}

function buildPresetLeafFunction(
  type,
  entry,
  defaultValue,
  newline
) {
  const functionName =
    leafFunctionName(
      type,
      entry.area,
      entry.action
    );

  const values =
    standardPresets
      .filter(
        (preset) =>
          Object.prototype
            .hasOwnProperty.call(
              entry.values,
              preset
            )
      )
      .map(
        (preset) => ({
          preset,
          value:
            entry.values[preset],
        })
      );

  const lines = [
    `    function ${functionName}(preset) {`,
  ];

  if (
    values.length === 0
  ) {
    lines.push(
      `      return ${literal(defaultValue)};`
    );

    lines.push(
      "    }"
    );

    return lines.join(
      newline
    );
  }

  lines.push(
    `      return preset == ${quote(values[0].preset)}`
  );

  lines.push(
    `        ? ${literal(values[0].value)}`
  );

  for (
    let index = 1;
    index <
      values.length;
    index += 1
  ) {
    lines.push(
      `        : preset == ${quote(values[index].preset)}`
    );

    lines.push(
      `          ? ${literal(values[index].value)}`
    );
  }

  lines.push(
    `          : ${literal(defaultValue)};`
  );

  lines.push(
    "    }"
  );

  return lines.join(
    newline
  );
}

function buildAreaFunction(
  type,
  area,
  entries,
  defaultValue,
  newline
) {
  const functionName =
    areaFunctionName(
      type,
      area
    );

  const lines = [
    `    function ${functionName}(preset, action) {`,
  ];

  const first =
    entries[0];

  lines.push(
    `      return action == ${quote(first.action)}`
  );

  lines.push(
    `        ? ${leafFunctionName(type, first.area, first.action)}(preset)`
  );

  for (
    let index = 1;
    index <
      entries.length;
    index += 1
  ) {
    const entry =
      entries[index];

    lines.push(
      `        : action == ${quote(entry.action)}`
    );

    lines.push(
      `          ? ${leafFunctionName(type, entry.area, entry.action)}(preset)`
    );
  }

  lines.push(
    `          : ${literal(defaultValue)};`
  );

  lines.push(
    "    }"
  );

  return lines.join(
    newline
  );
}

function buildTopRouter(
  type,
  grouped,
  defaultValue,
  newline
) {
  const areas =
    [
      ...grouped.keys(),
    ].sort();

  const functionName =
    type === "Scope"
      ? "ruleAdminStandardScope"
      : "ruleAdminStandardBoolean";

  const lines = [
    `    function ${functionName}(preset, area, action) {`,
  ];

  if (
    areas.length === 0
  ) {
    lines.push(
      `      return ${literal(defaultValue)};`
    );

    lines.push(
      "    }"
    );

    return lines.join(
      newline
    );
  }

  lines.push(
    `      return area == ${quote(areas[0])}`
  );

  lines.push(
    `        ? ${areaFunctionName(type, areas[0])}(preset, action)`
  );

  for (
    let index = 1;
    index <
      areas.length;
    index += 1
  ) {
    lines.push(
      `        : area == ${quote(areas[index])}`
    );

    lines.push(
      `          ? ${areaFunctionName(type, areas[index])}(preset, action)`
    );
  }

  lines.push(
    `          : ${literal(defaultValue)};`
  );

  lines.push(
    "    }"
  );

  return lines.join(
    newline
  );
}

const scopeEntries =
  sortedEntries(
    scopePermissions
  );

const booleanEntries =
  sortedEntries(
    booleanPermissions
  );

const scopeByArea =
  groupByArea(
    scopeEntries
  );

const booleanByArea =
  groupByArea(
    booleanEntries
  );

let baseRules =
  fs.readFileSync(
    baseRulesPath,
    "utf8"
  );

const existingHelperPattern =
  /\r?\n    \/\/ =+\r?\n    \/\/ BEGIN GENERATED STRUCTURED ADMIN HELPERS\r?\n[\s\S]*?    \/\/ END GENERATED STRUCTURED ADMIN HELPERS\r?\n    \/\/ =+\r?\n\r?\n/;

const existingHelperMatches =
  baseRules.match(
    new RegExp(
      existingHelperPattern.source,
      "g"
    )
  ) || [];

if (
  existingHelperMatches.length >
    1
) {
  throw new Error(
    "Multiple generated helper blocks were found."
  );
}

if (
  existingHelperMatches.length ===
    1
) {
  baseRules =
    baseRules.replace(
      existingHelperPattern,
      "\n"
    );
}

const newline =
  baseRules.includes(
    "\r\n"
  )
    ? "\r\n"
    : "\n";

const phrase =
  "Administrator privilege fields must be controlled";

if (
  baseRules
    .split(phrase)
    .length - 1 !==
      1
) {
  throw new Error(
    "The helper insertion anchor is not unique."
  );
}

const phraseIndex =
  baseRules.indexOf(
    phrase
  );

const commentStart =
  baseRules.lastIndexOf(
    "    /*",
    phraseIndex
  );

if (
  commentStart < 0
) {
  throw new Error(
    "Could not locate the helper insertion point."
  );
}

const scopeLeafFunctions =
  scopeEntries.map(
    (entry) =>
      buildPresetLeafFunction(
        "Scope",
        entry,
        "none",
        newline
      )
  );

const scopeAreaFunctions =
  [
    ...scopeByArea.entries(),
  ]
    .sort(
      (
        left,
        right
      ) =>
        left[0].localeCompare(
          right[0]
        )
    )
    .map(
      (
        [
          area,
          entries,
        ]
      ) =>
        buildAreaFunction(
          "Scope",
          area,
          entries,
          "none",
          newline
        )
    );

const booleanLeafFunctions =
  booleanEntries.map(
    (entry) =>
      buildPresetLeafFunction(
        "Boolean",
        entry,
        false,
        newline
      )
  );

const booleanAreaFunctions =
  [
    ...booleanByArea.entries(),
  ]
    .sort(
      (
        left,
        right
      ) =>
        left[0].localeCompare(
          right[0]
        )
    )
    .map(
      (
        [
          area,
          entries,
        ]
      ) =>
        buildAreaFunction(
          "Boolean",
          area,
          entries,
          false,
          newline
        )
    );

const scopeRouter =
  buildTopRouter(
    "Scope",
    scopeByArea,
    "none",
    newline
  );

const booleanRouter =
  buildTopRouter(
    "Boolean",
    booleanByArea,
    false,
    newline
  );

const assignablePresetLiteral =
  assignablePresets
    .map(quote)
    .join(", ");

const helperBlock = [
  "    // ========================================================",
  "    // BEGIN GENERATED STRUCTURED ADMIN HELPERS",
  "    //",
  "    // Generated from functions/adminAuthorization.js.",
  "    // Hierarchical area/action/preset routing keeps every",
  "    // permission evaluation below Firestore's expression limit.",
  "    // These helpers remain disconnected from production",
  "    // allow statements.",
  "    // ========================================================",
  "",
  "    function ruleAdminAccess() {",
  "      let user = myUser();",
  "",
  "      return (",
  '        "adminAccess" in user &&',
  "        user.adminAccess is map",
  "      )",
  "        ? user.adminAccess",
  "        : {};",
  "    }",
  "",
  "    function ruleAdminPreset() {",
  "      let access = ruleAdminAccess();",
  "",
  "      return (",
  '        "preset" in access &&',
  "        access.preset is string",
  "      )",
  "        ? access.preset",
  '        : "";',
  "    }",
  "",
  "    function ruleAdminProfileStatus() {",
  "      let user = myUser();",
  "",
  "      return (",
  '        "status" in user &&',
  "        user.status is string",
  "      )",
  "        ? user.status.lower()",
  "        : (",
  '            "accountStatus" in user &&',
  "            user.accountStatus is string",
  "          )",
  "            ? user.accountStatus.lower()",
  '            : "";',
  "    }",
  "",
  "    function ruleAdminProfileRole() {",
  "      let user = myUser();",
  "",
  "      return (",
  '        "role" in user &&',
  "        user.role is string",
  "      )",
  "        ? user.role.lower()",
  "        : (",
  '            "accountType" in user &&',
  "            user.accountType is string",
  "          )",
  "            ? user.accountType.lower()",
  '            : "";',
  "    }",
  "",
  "    function ruleAdminIsEnabled() {",
  "      let user = myUser();",
  "      let access = ruleAdminAccess();",
  "      let status = ruleAdminProfileStatus();",
  "      let role = ruleAdminProfileRole();",
  "",
  "      return isVerified()",
  '        && "adminAccess" in user',
  "        && user.adminAccess is map",
  '        && "version" in access',
  "        && access.version is int",
  "        && access.version >= 1",
  '        && "enabled" in access',
  "        && access.enabled == true",
  '        && "active" in access',
  "        && access.active == true",
  "        && (",
  '          !("isActive" in user) ||',
  "          user.isActive != false",
  "        )",
  "        && !(",
  "          status in [",
  '            "disabled",',
  '            "inactive",',
  '            "suspended",',
  '            "blocked",',
  '            "rejected"',
  "          ]",
  "        )",
  "        && (",
  '          role == "admin" ||',
  "          (",
  '            "isAdmin" in user &&',
  "            user.isAdmin == true",
  "          )",
  "        )",
  `        && ruleAdminPreset() in [${assignablePresetLiteral}];`,
  "    }",
  "",
  "    function ruleAdminPermissions() {",
  "      let access = ruleAdminAccess();",
  "",
  "      return (",
  '        "permissions" in access &&',
  "        access.permissions is map",
  "      )",
  "        ? access.permissions",
  "        : {};",
  "    }",
  "",
  "    function ruleAdminCustomScope(area, action) {",
  "      let permissions = ruleAdminPermissions();",
  "      let areaPermissions = (",
  "        area in permissions &&",
  "        permissions[area] is map",
  "      )",
  "        ? permissions[area]",
  "        : {};",
  "",
  "      return (",
  "        action in areaPermissions &&",
  "        areaPermissions[action] is string &&",
  "        areaPermissions[action] in [",
  '          "none",',
  '          "assigned",',
  '          "all"',
  "        ]",
  "      )",
  "        ? areaPermissions[action]",
  '        : "none";',
  "    }",
  "",
  "    function ruleAdminCustomBoolean(area, action) {",
  "      let permissions = ruleAdminPermissions();",
  "      let areaPermissions = (",
  "        area in permissions &&",
  "        permissions[area] is map",
  "      )",
  "        ? permissions[area]",
  "        : {};",
  "",
  '      return area == "adminManagement"',
  "        ? false",
  '        : action == ""',
  "          ? (",
  "              area in permissions &&",
  "              permissions[area] is bool &&",
  "              permissions[area] == true",
  "            )",
  "          : (",
  "              action in areaPermissions &&",
  "              areaPermissions[action] is bool &&",
  "              areaPermissions[action] == true",
  "            );",
  "    }",
  "",
  ...scopeLeafFunctions,
  "",
  ...scopeAreaFunctions,
  "",
  scopeRouter,
  "",
  ...booleanLeafFunctions,
  "",
  ...booleanAreaFunctions,
  "",
  booleanRouter,
  "",
  "    function ruleAdminPermissionScope(area, action) {",
  "      let preset = ruleAdminPreset();",
  "",
  "      return !ruleAdminIsEnabled()",
  '        ? "none"',
  '        : preset == "custom"',
  "          ? ruleAdminCustomScope(area, action)",
  "          : ruleAdminStandardScope(",
  "              preset,",
  "              area,",
  "              action",
  "            );",
  "    }",
  "",
  "    function ruleAdminBooleanPermission(area, action) {",
  "      let preset = ruleAdminPreset();",
  "",
  "      return !ruleAdminIsEnabled()",
  "        ? false",
  '        : preset == "custom"',
  "          ? ruleAdminCustomBoolean(area, action)",
  "          : ruleAdminStandardBoolean(",
  "              preset,",
  "              area,",
  "              action",
  "            );",
  "    }",
  "",
  "    function ruleAdminAssignedClientIds() {",
  "      let access = ruleAdminAccess();",
  "",
  "      return (",
  '        "assignedClientIds" in access &&',
  "        access.assignedClientIds is list",
  "      )",
  "        ? access.assignedClientIds",
  "        : [];",
  "    }",
  "",
  "    function ruleAdminIsAssignedClient(clientId) {",
  "      return clientId is string",
  '        && clientId != ""',
  "        && clientId in ruleAdminAssignedClientIds();",
  "    }",
  "",
  "    function ruleAdminCanAccessClient(area, action, clientId) {",
  "      let scope = ruleAdminPermissionScope(area, action);",
  "",
  '      return scope == "all"',
  "        || (",
  '          scope == "assigned" &&',
  "          ruleAdminIsAssignedClient(clientId)",
  "        );",
  "    }",
  "",
  "    function ruleAdminHasBoolean(area, action) {",
  "      return ruleAdminBooleanPermission(area, action);",
  "    }",
  "",
  "    // ========================================================",
  "    // END GENERATED STRUCTURED ADMIN HELPERS",
  "    // ========================================================",
].join(newline);

const candidateRules =
  baseRules.slice(
    0,
    commentStart
  ) +
  helperBlock +
  newline +
  newline +
  baseRules.slice(
    commentStart
  );

const baselineAllowLines =
  baseRules.match(
    /^\s*allow\b.*$/gm
  ) || [];

const candidateAllowLines =
  candidateRules.match(
    /^\s*allow\b.*$/gm
  ) || [];

if (
  JSON.stringify(
    baselineAllowLines
  ) !==
  JSON.stringify(
    candidateAllowLines
  )
) {
  throw new Error(
    "A production allow statement changed."
  );
}

if (
  candidateAllowLines.some(
    (line) =>
      line.includes(
        "ruleAdmin"
      )
  )
) {
  throw new Error(
    "A production allow statement references the helper scaffold."
  );
}

const finalClosePattern =
  /(\r?\n  }\r?\n}\s*)$/;

if (
  !finalClosePattern.test(
    candidateRules
  )
) {
  throw new Error(
    "Could not locate the final rules closing braces."
  );
}

const probeBlock = [
  "",
  "    // Compatibility marker used only by the matrix test:",
  "    // match /__adminPermissionProbe/",
  "",
  "    match /__adminPermissionProbeActive/{probeId} {",
  "      allow get: if ruleAdminIsEnabled();",
  "    }",
  "",
  "    match /__adminPermissionProbeScope/{probeId} {",
  "      allow get: if ruleAdminCanAccessClient(",
  "        resource.data.area,",
  "        resource.data.action,",
  "        resource.data.clientId",
  "      );",
  "    }",
  "",
  "    match /__adminPermissionProbeBoolean/{probeId} {",
  "      allow get: if ruleAdminHasBoolean(",
  "        resource.data.area,",
  "        resource.data.action",
  "      );",
  "    }",
].join(newline);

const probeRules =
  candidateRules.replace(
    finalClosePattern,
    `${probeBlock}$1`
  );

const summary = {
  assignablePresets,

  standardPresets,

  scopePermissionPaths:
    scopeEntries.length,

  booleanPermissionPaths:
    booleanEntries.length,

  scopeAreas:
    scopeByArea.size,

  booleanAreas:
    booleanByArea.size,

  baselineAllowStatements:
    baselineAllowLines.length,

  candidateAllowStatements:
    candidateAllowLines.length,

  productionAllowHelperReferences:
    candidateAllowLines
      .filter(
        (line) =>
          line.includes(
            "ruleAdmin"
          )
      ).length,

  productionProbeMatches:
    (
      candidateRules.match(
        /match\s+\/__adminPermissionProbe\//g
      ) || []
    ).length,

  probeRuleMatches:
    (
      probeRules.match(
        /match\s+\/__adminPermissionProbe\//g
      ) || []
    ).length,

  largeMatrixDeclarations:
    (
      candidateRules.match(
        /let\s+matrix\s*=/g
      ) || []
    ).length,

  hierarchicalCommentMarkers:
    (
      candidateRules.match(
        /Hierarchical area\/action\/preset routing/g
      ) || []
    ).length,
};

console.log(
  JSON.stringify(
    summary,
    null,
    2
  )
);

if (
  summary.productionAllowHelperReferences !==
    0 ||
  summary.productionProbeMatches !==
    0 ||
  summary.probeRuleMatches !==
    1 ||
  summary.largeMatrixDeclarations !==
    0 ||
  summary.hierarchicalCommentMarkers !==
    1 ||
  summary.scopePermissionPaths <
    1 ||
  summary.booleanPermissionPaths <
    1
) {
  throw new Error(
    "Hierarchical candidate verification failed."
  );
}

fs.writeFileSync(
  outputRulesPath,
  candidateRules,
  "utf8"
);

fs.writeFileSync(
  probeRulesPath,
  probeRules,
  "utf8"
);

console.log("");
console.log(
  "SUCCESS: Hierarchical Firestore helper candidates were generated."
);

console.log(
  "SUCCESS: Existing production allow statements remained unchanged."
);

console.log(
  "SUCCESS: No large permission matrix was generated."
);

console.log(
  "SUCCESS: The probe collection exists only in the probe candidate."
);