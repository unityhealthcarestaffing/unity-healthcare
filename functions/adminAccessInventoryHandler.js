"use strict";

const {
  INVENTORY_CATEGORIES,
  buildAdminAccessInventory,
} = require("./adminAccessInventory");

const {
  isProtectedSuperAdminEmail,
} = require("./adminAuthorization");

const MAX_INVENTORY_USERS = 5000;

const INVENTORY_SELECT_FIELDS = Object.freeze([
  "uid",
  "email",
  "fullName",
  "displayName",
  "name",
  "organisationName",
  "role",
  "accountType",
  "isAdmin",
  "isActive",
  "status",
  "adminAccess",
]);

function normaliseEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function assertEmptyRequestData(
  data,
  HttpsError
) {
  if (
    data === undefined ||
    data === null
  ) {
    return;
  }

  if (
    !isPlainObject(data) ||
    Object.keys(data).length !== 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      "No request fields are supported."
    );
  }
}

function createAdminAccessInventoryHandler({
  admin,
  HttpsError,
}) {
  if (
    !admin ||
    typeof admin.firestore !== "function" ||
    typeof HttpsError !== "function"
  ) {
    throw new Error(
      "admin and HttpsError are required."
    );
  }

  return async function getAdminAccessInventory(
    request
  ) {
    if (
      !request?.auth?.uid
    ) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in."
      );
    }

    if (
      request.auth.token
        ?.email_verified !== true
    ) {
      throw new HttpsError(
        "permission-denied",
        "The protected Super Admin email must be verified."
      );
    }

    const callerEmail =
      normaliseEmail(
        request.auth.token?.email
      );

    if (
      !isProtectedSuperAdminEmail(
        callerEmail
      )
    ) {
      throw new HttpsError(
        "permission-denied",
        "Protected Super Admin access is required."
      );
    }

    assertEmptyRequestData(
      request.data,
      HttpsError
    );

    try {
      const snapshot =
        await admin
          .firestore()
          .collection("users")
          .select(
            ...INVENTORY_SELECT_FIELDS
          )
          .limit(
            MAX_INVENTORY_USERS + 1
          )
          .get();

      const documents =
        Array.isArray(snapshot?.docs)
          ? snapshot.docs
          : [];

      if (
        documents.length >
          MAX_INVENTORY_USERS
      ) {
        throw new HttpsError(
          "resource-exhausted",
          `Administrator inventory is limited to ${MAX_INVENTORY_USERS} user profiles.`
        );
      }

      const records =
        documents.map(
          (document) => ({
            id:
              String(
                document?.id ?? ""
              ).trim(),

            data:
              typeof document?.data ===
                "function"
                ? document.data() || {}
                : {},
          })
        );

      const inventory =
        buildAdminAccessInventory(
          records
        );

      const administrators =
        inventory.items.filter(
          (item) =>
            item.category !==
              INVENTORY_CATEGORIES
                .NON_ADMIN
        );

      return {
        ok:
          true,

        scannedUserCount:
          inventory.total,

        administratorCount:
          administrators.length,

        counts: {
          ...inventory.counts,
        },

        migrationRequiredCount:
          inventory
            .migrationRequiredCount,

        blockedByStructuredRulesCount:
          inventory
            .blockedByStructuredRulesCount,

        administrators,
      };
    } catch (
      error
    ) {
      if (
        error instanceof HttpsError
      ) {
        throw error;
      }

      console.error(
        "getAdminAccessInventoryV2 error:",
        error
      );

      throw new HttpsError(
        "internal",
        "Administrator inventory could not be generated."
      );
    }
  };
}

module.exports = {
  INVENTORY_SELECT_FIELDS,
  MAX_INVENTORY_USERS,
  createAdminAccessInventoryHandler,
};