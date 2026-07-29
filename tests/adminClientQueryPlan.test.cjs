"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const utilityPath =
  path.resolve(
    __dirname,
    "..",
    "src",
    "utils",
    "adminClientQueryPlan.js"
  );

const source =
  fs.readFileSync(
    utilityPath,
    "utf8"
  );

const exportNames = [
  "MAX_ASSIGNED_CLIENT_IDS",
  "FIRESTORE_IN_QUERY_LIMIT",
  "ADMIN_CLIENT_READ_MODES",
  "normalizeAssignedClientIds",
  "chunkAssignedClientIds",
  "resolveAdminClientReadPlan",
  "adminClientCreatedAtMillis",
  "sortAdminClientRowsByCreatedAtDesc",
  "mergeAdminClientRows",
];

const transformed =
  source
    .replace(
      /\bexport\s+const\s+/g,
      "const "
    )
    .replace(
      /\bexport\s+function\s+/g,
      "function "
    ) +
  `\nmodule.exports = {${exportNames.join(
    ","
  )}};\n`;

const moduleRecord = {
  exports: {},
};

const evaluate =
  new Function(
    "module",
    "exports",
    transformed
  );

evaluate(
  moduleRecord,
  moduleRecord.exports
);

const utility =
  moduleRecord.exports;

function plain(
  value
) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

test(
  "query limits match the security contract",
  () => {
    assert.equal(
      utility
        .MAX_ASSIGNED_CLIENT_IDS,
      200
    );

    assert.equal(
      utility
        .FIRESTORE_IN_QUERY_LIMIT,
      30
    );
  }
);

test(
  "normalises, trims and deduplicates client IDs",
  () => {
    assert.deepEqual(
      utility
        .normalizeAssignedClientIds([
          " client-a ",
          "client-b",
          "client-a",
          "",
          null,
        ]),
      [
        "client-a",
        "client-b",
      ]
    );
  }
);

test(
  "rejects invalid document paths containing a slash",
  () => {
    assert.deepEqual(
      utility
        .normalizeAssignedClientIds([
          "client-a",
          "clients/client-b",
          "/client-c",
          "client-d/",
        ]),
      [
        "client-a",
      ]
    );
  }
);

test(
  "caps assigned client IDs at 200",
  () => {
    const input =
      Array.from(
        {
          length: 250,
        },
        (
          _,
          index
        ) =>
          `client-${index}`
      );

    const result =
      utility
        .normalizeAssignedClientIds(
          input
        );

    assert.equal(
      result.length,
      200
    );

    assert.equal(
      result[0],
      "client-0"
    );

    assert.equal(
      result[199],
      "client-199"
    );
  }
);

test(
  "splits IDs into Firestore-safe groups of 30",
  () => {
    const input =
      Array.from(
        {
          length: 65,
        },
        (
          _,
          index
        ) =>
          `client-${index}`
      );

    const chunks =
      utility
        .chunkAssignedClientIds(
          input
        );

    assert.deepEqual(
      chunks.map(
        (
          chunk
        ) =>
          chunk.length
      ),
      [
        30,
        30,
        5,
      ]
    );
  }
);

test(
  "rejects an unsafe chunk size",
  () => {
    assert.throws(
      () =>
        utility
          .chunkAssignedClientIds(
            [
              "client-a",
            ],
            31
          ),
      RangeError
    );

    assert.throws(
      () =>
        utility
          .chunkAssignedClientIds(
            [
              "client-a",
            ],
            0
          ),
      RangeError
    );
  }
);

test(
  "denies a non-administrator read plan",
  () => {
    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            false,

          active:
            true,

          permissions: {
            clients: {
              view:
                "all",
            },
          },
        });

    assert.deepEqual(
      plain(result),
      {
        mode:
          "empty",

        scope:
          "none",

        assignedClientIds:
          [],

        chunks:
          [],
      }
    );
  }
);

test(
  "creates an unrestricted plan for all-client access",
  () => {
    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            true,

          active:
            true,

          permissions: {
            clients: {
              view:
                "all",
            },
          },
        });

    assert.deepEqual(
      plain(result),
      {
        mode:
          "all",

        scope:
          "all",

        assignedClientIds:
          [],

        chunks:
          [],
      }
    );
  }
);

test(
  "protected Super Admin receives unrestricted plan",
  () => {
    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            true,

          isSuperAdmin:
            true,

          active:
            true,

          permissions: {
            clients: {
              view:
                "none",
            },
          },
        });

    assert.equal(
      result.mode,
      "all"
    );

    assert.equal(
      result.scope,
      "all"
    );
  }
);

test(
  "creates chunked plan for assigned-client access",
  () => {
    const assignedClientIds =
      Array.from(
        {
          length: 61,
        },
        (
          _,
          index
        ) =>
          `client-${index}`
      );

    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            true,

          active:
            true,

          assignedClientIds,

          permissions: {
            clients: {
              view:
                "assigned",
            },
          },
        });

    assert.equal(
      result.mode,
      "assigned"
    );

    assert.equal(
      result.scope,
      "assigned"
    );

    assert.equal(
      result
        .assignedClientIds
        .length,
      61
    );

    assert.deepEqual(
      result.chunks.map(
        (
          chunk
        ) =>
          chunk.length
      ),
      [
        30,
        30,
        1,
      ]
    );
  }
);

test(
  "assigned scope without client IDs returns an empty plan",
  () => {
    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            true,

          active:
            true,

          assignedClientIds:
            [],

          permissions: {
            clients: {
              view:
                "assigned",
            },
          },
        });

    assert.equal(
      result.mode,
      "empty"
    );

    assert.equal(
      result.scope,
      "assigned"
    );
  }
);

test(
  "none scope returns an empty plan",
  () => {
    const result =
      utility
        .resolveAdminClientReadPlan({
          isAdmin:
            true,

          active:
            true,

          permissions: {
            clients: {
              view:
                "none",
            },
          },
        });

    assert.equal(
      result.mode,
      "empty"
    );

    assert.equal(
      result.scope,
      "none"
    );
  }
);

test(
  "merges duplicate client rows and sorts newest first",
  () => {
    const result =
      utility
        .mergeAdminClientRows([
          [
            {
              id:
                "client-a",

              organisationName:
                "Old A",

              createdAt: {
                seconds:
                  100,
              },
            },

            {
              id:
                "client-b",

              createdAt: {
                seconds:
                  300,
              },
            },
          ],

          [
            {
              id:
                "client-a",

              organisationName:
                "Updated A",

              createdAt: {
                seconds:
                  200,
              },
            },

            {
              id:
                "client-c",

              createdAt: {
                seconds:
                  50,
              },
            },
          ],
        ]);

    assert.deepEqual(
      result.map(
        (
          row
        ) =>
          row.id
      ),
      [
        "client-b",
        "client-a",
        "client-c",
      ]
    );

    assert.equal(
      result[1]
        .organisationName,
      "Updated A"
    );
  }
);

test(
  "supports Firestore timestamps, Dates and ISO strings",
  () => {
    assert.equal(
      utility
        .adminClientCreatedAtMillis({
          toMillis() {
            return 5000;
          },
        }),
      5000
    );

    assert.equal(
      utility
        .adminClientCreatedAtMillis(
          new Date(
            "2026-01-01T00:00:00.000Z"
          )
        ),
      Date.parse(
        "2026-01-01T00:00:00.000Z"
      )
    );

    assert.equal(
      utility
        .adminClientCreatedAtMillis(
          "2026-02-01T00:00:00.000Z"
        ),
      Date.parse(
        "2026-02-01T00:00:00.000Z"
      )
    );
  }
);

test(
  "sorting and chunking do not mutate their inputs",
  () => {
    const ids = [
      "client-a",
      "client-b",
    ];

    const rows = [
      {
        id:
          "client-a",

        createdAt:
          1,
      },

      {
        id:
          "client-b",

        createdAt:
          2,
      },
    ];

    const originalIds =
      [...ids];

    const originalRows =
      [...rows];

    utility
      .chunkAssignedClientIds(
        ids
      );

    utility
      .sortAdminClientRowsByCreatedAtDesc(
        rows
      );

    assert.deepEqual(
      ids,
      originalIds
    );

    assert.deepEqual(
      rows,
      originalRows
    );
  }
);