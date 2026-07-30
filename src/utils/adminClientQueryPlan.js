export const MAX_ASSIGNED_CLIENT_IDS = 200;

export const FIRESTORE_IN_QUERY_LIMIT = 30;

export const ADMIN_CLIENT_READ_MODES = {
  ALL: "all",
  ASSIGNED: "assigned",
  EMPTY: "empty",
};

function cleanClientId(value) {
  const clientId =
    String(
      value ?? ""
    ).trim();

  if (
    !clientId ||
    clientId.includes("/")
  ) {
    return "";
  }

  return clientId;
}

export function normalizeAssignedClientIds(
  values
) {
  if (
    !Array.isArray(values)
  ) {
    return [];
  }

  const uniqueIds =
    new Set();

  for (
    const value of
    values
  ) {
    const clientId =
      cleanClientId(
        value
      );

    if (
      !clientId
    ) {
      continue;
    }

    uniqueIds.add(
      clientId
    );

    if (
      uniqueIds.size >=
        MAX_ASSIGNED_CLIENT_IDS
    ) {
      break;
    }
  }

  return [
    ...uniqueIds,
  ];
}

export function chunkAssignedClientIds(
  values,
  chunkSize =
    FIRESTORE_IN_QUERY_LIMIT
) {
  if (
    !Number.isInteger(
      chunkSize
    ) ||
    chunkSize < 1 ||
    chunkSize >
      FIRESTORE_IN_QUERY_LIMIT
  ) {
    throw new RangeError(
      `Assigned-client query chunk size must be between 1 and ${FIRESTORE_IN_QUERY_LIMIT}.`
    );
  }

  const clientIds =
    normalizeAssignedClientIds(
      values
    );

  const chunks = [];

  for (
    let index = 0;
    index <
      clientIds.length;
    index +=
      chunkSize
  ) {
    chunks.push(
      clientIds.slice(
        index,
        index +
          chunkSize
      )
    );
  }

  return chunks;
}

export function resolveAdminClientReadPlan(
  adminAccess
) {
  const isActiveAdmin =
    adminAccess?.isAdmin ===
      true &&
    adminAccess?.active !==
      false;

  if (
    !isActiveAdmin
  ) {
    return {
      mode:
        ADMIN_CLIENT_READ_MODES
          .EMPTY,

      scope:
        "none",

      assignedClientIds:
        [],

      chunks:
        [],
    };
  }

  const scope =
    adminAccess
      ?.permissions
      ?.clients
      ?.view;

  if (
    adminAccess?.isSuperAdmin ===
      true ||
    scope === "all"
  ) {
    return {
      mode:
        ADMIN_CLIENT_READ_MODES
          .ALL,

      scope:
        "all",

      assignedClientIds:
        [],

      chunks:
        [],
    };
  }

  if (
    scope !== "assigned"
  ) {
    return {
      mode:
        ADMIN_CLIENT_READ_MODES
          .EMPTY,

      scope:
        "none",

      assignedClientIds:
        [],

      chunks:
        [],
    };
  }

  const assignedClientIds =
    normalizeAssignedClientIds(
      adminAccess
        ?.assignedClientIds
    );

  if (
    assignedClientIds.length ===
      0
  ) {
    return {
      mode:
        ADMIN_CLIENT_READ_MODES
          .EMPTY,

      scope:
        "assigned",

      assignedClientIds:
        [],

      chunks:
        [],
    };
  }

  return {
    mode:
      ADMIN_CLIENT_READ_MODES
        .ASSIGNED,

    scope:
      "assigned",

    assignedClientIds,

    chunks:
      chunkAssignedClientIds(
        assignedClientIds
      ),
  };
}

export function adminClientCreatedAtMillis(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  if (
    typeof value?.toMillis ===
      "function"
  ) {
    try {
      const milliseconds =
        Number(
          value.toMillis()
        );

      return Number.isFinite(
        milliseconds
      )
        ? milliseconds
        : 0;
    } catch {
      return 0;
    }
  }

  if (
    value instanceof Date
  ) {
    const milliseconds =
      value.getTime();

    return Number.isFinite(
      milliseconds
    )
      ? milliseconds
      : 0;
  }

  if (
    typeof value ===
      "object" &&
    Number.isFinite(
      Number(
        value.seconds
      )
    )
  ) {
    const seconds =
      Number(
        value.seconds
      );

    const nanoseconds =
      Number.isFinite(
        Number(
          value.nanoseconds
        )
      )
        ? Number(
            value.nanoseconds
          )
        : 0;

    return (
      seconds *
        1000 +
      nanoseconds /
        1000000
    );
  }

  if (
    typeof value ===
      "number"
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : 0;
  }

  if (
    typeof value ===
      "string"
  ) {
    const milliseconds =
      Date.parse(
        value
      );

    return Number.isFinite(
      milliseconds
    )
      ? milliseconds
      : 0;
  }

  return 0;
}

export function sortAdminClientRowsByCreatedAtDesc(
  rows
) {
  const safeRows =
    Array.isArray(rows)
      ? [...rows]
      : [];

  return safeRows.sort(
    (
      left,
      right
    ) => {
      const timeDifference =
        adminClientCreatedAtMillis(
          right?.createdAt
        ) -
        adminClientCreatedAtMillis(
          left?.createdAt
        );

      if (
        timeDifference !==
          0
      ) {
        return timeDifference;
      }

      return String(
        left?.id ?? ""
      ).localeCompare(
        String(
          right?.id ?? ""
        )
      );
    }
  );
}

export function mergeAdminClientRows(
  rowGroups
) {
  if (
    !Array.isArray(
      rowGroups
    )
  ) {
    return [];
  }

  const rowsById =
    new Map();

  for (
    const group of
    rowGroups
  ) {
    if (
      !Array.isArray(
        group
      )
    ) {
      continue;
    }

    for (
      const row of
      group
    ) {
      const clientId =
        cleanClientId(
          row?.id
        );

      if (
        !clientId
      ) {
        continue;
      }

      rowsById.set(
        clientId,
        {
          ...row,
          id:
            clientId,
        }
      );
    }
  }

  return sortAdminClientRowsByCreatedAtDesc(
    [
      ...rowsById.values(),
    ]
  );
}