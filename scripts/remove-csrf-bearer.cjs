const fs = require("fs");
const path = require("path");

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(filePath);
    }
  }
}

walk("src");

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;

  after = after.replace(/\s*["']Authorization["']\s*:\s*`Bearer \$\{[^}]+\}`\s*,?/g, "");
  after = after.replace(/\s*headers\[['"]Authorization['"]\]\s*=\s*`Bearer \$\{[^}]+\}`;\n?/g, "");
  after = after.replace(/\{\s*["']Authorization["']\s*:\s*`Bearer \$\{([^}]+)\}`\s*\}/g, "{}");
  after = after.replace(/\{\s*["']Authorization["']\s*:\s*`Bearer \$\{([^}]+)\}`\s*,\s*["']X-CSRF-Token["']\s*:\s*\1\s*\}/g, "{ \"X-CSRF-Token\": $1 }");
  after = after.replace(/\{\s*["']X-CSRF-Token["']\s*:\s*([^}]+)\s*,\s*["']Authorization["']\s*:\s*`Bearer \$\{\1\}`\s*\}/g, "{ \"X-CSRF-Token\": $1 }");
  after = after.replace(/\{\s*,/g, "{");
  after = after.replace(/,\s*,/g, ",");
  after = after.replace(/data\?\.token/g, "data?.csrfToken");
  after = after.replace(/data\.token/g, "data.csrfToken");
  after = after.replace(/authData\.token/g, "authData.csrfToken");

  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
  }
}
