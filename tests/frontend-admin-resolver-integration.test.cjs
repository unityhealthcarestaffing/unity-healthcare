"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const root =
  path.resolve(
    __dirname,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath
    ),
    "utf8"
  );
}

function countLiteral(
  source,
  value
) {
  return (
    source.split(value).length -
    1
  );
}

const main =
  read("src/main.jsx");

const clientInvoices =
  read(
    "src/components/ClientInvoices.jsx"
  );

const shiftsList =
  read(
    "src/components/ShiftsList.jsx"
  );

const adminAccess =
  read(
    "src/utils/adminAccess.js"
  );

const app =
  read("src/App.jsx");

test(
  "main route imports the shared administrator utilities",
  () => {
    assert.equal(
      countLiteral(
        main,
        'from "./utils/adminAccess";'
      ),
      1
    );

    assert.match(
      main,
      /\bresolveAdminAccess\b/
    );

    assert.match(
      main,
      /\bcanViewAdminTab\b/
    );
  }
);

test(
  "main route has no local administrator helper",
  () => {
    assert.doesNotMatch(
      main,
      /function\s+isAdminEmail\s*\(/
    );

    assert.doesNotMatch(
      main,
      /function\s+isAdminProfile\s*\(/
    );
  }
);

test(
  "main route resolves protected access without a profile",
  () => {
    assert.match(
      main,
      /resolveAdminAccess\(\s*user,\s*null\s*\)/
    );

    assert.match(
      main,
      /protectedAccess\.isSuperAdmin/
    );
  }
);

test(
  "main route checks staff-application permission",
  () => {
    assert.equal(
      countLiteral(
        main,
        '"admin-staff-applications"'
      ),
      2
    );
  }
);

test(
  "ClientInvoices imports the shared administrator utilities",
  () => {
    assert.equal(
      countLiteral(
        clientInvoices,
        'from "../utils/adminAccess";'
      ),
      1
    );

    assert.match(
      clientInvoices,
      /\bresolveAdminAccess\b/
    );

    assert.match(
      clientInvoices,
      /\bcanViewAdminTab\b/
    );
  }
);

test(
  "ClientInvoices has no separate administrator allowlist",
  () => {
    assert.doesNotMatch(
      clientInvoices,
      /const\s+ADMIN_EMAILS\s*=/
    );

    assert.doesNotMatch(
      clientInvoices,
      /const\s+isAdminUser\s*=/
    );

    assert.doesNotMatch(
      clientInvoices,
      /valentineenyi18@gmail\.com/i
    );
  }
);

test(
  "ClientInvoices loads protected and structured access",
  () => {
    assert.match(
      clientInvoices,
      /const\s+loadCurrentAdminAccess\s*=\s*async/
    );

    assert.match(
      clientInvoices,
      /resolveAdminAccess\(\s*currentUser,\s*null\s*\)/
    );

    assert.match(
      clientInvoices,
      /resolveAdminAccess\(\s*currentUser,\s*profile\s*\)/
    );
  }
);

test(
  "ClientInvoices checks invoice-view permission",
  () => {
    assert.equal(
      countLiteral(
        clientInvoices,
        '"admin-invoices"'
      ),
      1
    );

    assert.match(
      clientInvoices,
      /does not include invoice-view access/
    );
  }
);

test(
  "ShiftsList imports the shared resolver",
  () => {
    assert.equal(
      countLiteral(
        shiftsList,
        'from "../utils/adminAccess";'
      ),
      1
    );
  }
);

test(
  "ShiftsList has no separate administrator allowlist",
  () => {
    assert.doesNotMatch(
      shiftsList,
      /const\s+ADMIN_EMAILS\s*=/
    );

    assert.doesNotMatch(
      shiftsList,
      /function\s+isAdminEmail\s*\(/
    );
  }
);

test(
  "ShiftsList resolves access using the loaded profile",
  () => {
    assert.match(
      shiftsList,
      /resolveAdminAccess\(\s*currentUser,\s*staffProfile\s*\)/
    );
  }
);

test(
  "ShiftsList requires Staff Portal Access for administrators",
  () => {
    assert.match(
      shiftsList,
      /!adminAccess\.isAdmin/
    );

    assert.match(
      shiftsList,
      /staffPortalAccess\s*===\s*true/
    );
  }
);

test(
  "ShiftsList combines Staff Portal and active-user access",
  () => {
    assert.match(
      shiftsList,
      /canUseStaffPortal\s*&&/
    );

    assert.match(
      shiftsList,
      /adminAccess\.isAdmin\s*\|\|\s*staffIsActive/
    );

    assert.match(
      shiftsList,
      /does not include Staff Portal Access/
    );
  }
);

test(
  "App retains its existing tested resolver integration",
  () => {
    assert.match(
      app,
      /resolveAdminAccess\(user,\s*profile\)/
    );

    assert.match(
      app,
      /canViewAdminTab\(adminAccess,\s*tab\.id\)/
    );
  }
);

test(
  "shared utility still exports both authorisation functions",
  () => {
    assert.equal(
      countLiteral(
        adminAccess,
        "export function resolveAdminAccess("
      ),
      1
    );

    assert.equal(
      countLiteral(
        adminAccess,
        "export function canViewAdminTab("
      ),
      1
    );
  }
);