"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  resolveTimesheetClientOwnership,
} = require(
  "../timesheetOwnership"
);

test(
  "canonical clientId is stored in every ownership ID field",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        clientId:
          "client-primary",
      });

    assert.equal(
      result.clientId,
      "client-primary"
    );

    assert.equal(
      result.clientUid,
      "client-primary"
    );

    assert.equal(
      result.clientUserId,
      "client-primary"
    );
  }
);

test(
  "legacy clientUid is accepted",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        clientUid:
          "client-uid",
      });

    assert.equal(
      result.clientId,
      "client-uid"
    );
  }
);

test(
  "legacy clientUserId is accepted",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        clientUserId:
          "client-user-id",
      });

    assert.equal(
      result.clientId,
      "client-user-id"
    );
  }
);

test(
  "legacy createdBy is accepted",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        createdBy:
          "legacy-created-by",
      });

    assert.equal(
      result.clientId,
      "legacy-created-by"
    );
  }
);

test(
  "legacy createdByUid is accepted",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        createdByUid:
          "legacy-created-by-uid",
      });

    assert.equal(
      result.clientId,
      "legacy-created-by-uid"
    );
  }
);

test(
  "canonical ownership takes precedence and metadata is normalised",
  () => {
    const result =
      resolveTimesheetClientOwnership({
        clientId:
          "  canonical-client  ",

        clientUid:
          "lower-priority-client",

        clientEmail:
          "  client@example.test  ",

        organisationName:
          "  Example Care Ltd  ",

        clientCode:
          "  CL-000123  ",
      });

    assert.deepEqual(
      result,
      {
        clientId:
          "canonical-client",

        clientUid:
          "canonical-client",

        clientUserId:
          "canonical-client",

        clientEmail:
          "client@example.test",

        clientOrganisation:
          "Example Care Ltd",

        clientPublicId:
          "CL-000123",
      }
    );
  }
);

test(
  "missing ownership returns safe null fields",
  () => {
    assert.deepEqual(
      resolveTimesheetClientOwnership(
        null
      ),
      {
        clientId: null,
        clientUid: null,
        clientUserId: null,
        clientEmail: null,
        clientOrganisation: null,
        clientPublicId: null,
      }
    );
  }
);

test(
  "submitTimesheetV2 uses stored-shift ownership and never browser ownership",
  () => {
    const indexSource =
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../index.js"
        ),
        "utf8"
      );

    const start =
      indexSource.indexOf(
        "exports.submitTimesheetV2 ="
      );

    const end =
      indexSource.indexOf(
        "exports.createInvoiceOnTimesheetApprovedV2 =",
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const block =
      indexSource.slice(
        start,
        end
      );

    assert.match(
      block,
      /resolveTimesheetClientOwnership\(\s*shift\s*\)/
    );

    assert.match(
      block,
      /clientId:\s*ownership\.clientId/
    );

    assert.match(
      block,
      /clientUid:\s*ownership\.clientUid/
    );

    assert.match(
      block,
      /clientUserId:\s*ownership\.clientUserId/
    );

    assert.match(
      block,
      /clientEmail:\s*ownership\.clientEmail/
    );

    assert.match(
      block,
      /if\s*\(!ownership\.clientId\)/
    );

    assert.doesNotMatch(
      block,
      /request\.data\?\.(?:clientId|clientUid|clientUserId|clientEmail)/
    );
  }
);