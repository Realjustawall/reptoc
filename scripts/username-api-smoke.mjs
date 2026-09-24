import "dotenv/config";
import pg from "pg";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
const database = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING,
});

class SessionClient {
  cookies = new Map();
  csrfToken = "";

  storeCookies(response) {
    const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    if (this.cookies.has("XSRF-TOKEN")) {
      this.csrfToken = decodeURIComponent(this.cookies.get("XSRF-TOKEN"));
    }
  }

  async request(method, path, body, authenticated = false) {
    const headers = { "X-Forwarded-For": "198.18.44.42" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    if (authenticated && this.csrfToken) {
      headers["X-CSRF-Token"] = this.csrfToken;
      headers.Authorization = `Bearer ${this.csrfToken}`;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.storeCookies(response);
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    return { response, data };
  }
}

function expect(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  }
  console.log(`PASS ${message}`);
}

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const oldUsername = `ApiOld${stamp}`.slice(0, 30);
const newUsername = `ApiNew${stamp}`.slice(0, 30);
const password = "Aa1!UsernameSmoke";
const session = new SessionClient();
let userId = "";

try {
  let result = await session.request("POST", "/api/auth/register", {
    username: oldUsername,
    password,
    email: `${oldUsername.toLowerCase()}@example.test`,
    nickname: "Username API Test",
  });
  expect(result.response.status === 200 && result.data?.success, "register isolated username fixture", result.data);
  userId = result.data.user.id;

  result = await session.request("PATCH", "/api/auth/username", { username: newUsername }, true);
  expect(result.response.status === 200 && result.data?.user?.id === userId, "rename keeps the immutable user id", result.data);
  expect(result.data?.user?.username === newUsername, "rename returns the new username", result.data);

  result = await session.request("GET", "/api/auth/me", undefined, true);
  expect(result.response.status === 200 && result.data?.user?.id === userId, "active session survives rename", result.data);
  expect(result.data?.user?.username === newUsername, "active session immediately sees the new username", result.data);

  result = await session.request("GET", `/api/users/resolve/${encodeURIComponent(oldUsername)}`);
  expect(
    result.response.status === 200 && result.data?.id === userId && result.data?.username === newUsername && result.data?.redirected,
    "old username resolves to the current profile",
    result.data,
  );

  result = await session.request("GET", `/authors/${encodeURIComponent(oldUsername)}`);
  expect(
    result.response.status === 308 && result.response.headers.get("location") === `/authors/${encodeURIComponent(newUsername)}`,
    "old profile URL returns a permanent canonical redirect",
    { status: result.response.status, location: result.response.headers.get("location") },
  );

  const freshLogin = new SessionClient();
  result = await freshLogin.request("POST", "/api/auth/login", { username: newUsername.toUpperCase(), password });
  expect(result.response.status === 200 && result.data?.user?.id === userId, "new username login works case-insensitively", result.data);

  result = await session.request("PATCH", "/api/auth/username", { username: `${newUsername}X`.slice(0, 30) }, true);
  expect(result.response.status === 429 && result.data?.code === "USERNAME_COOLDOWN", "fourteen-day cooldown is enforced by the server", result.data);

  const conflictingRegistration = new SessionClient();
  result = await conflictingRegistration.request("POST", "/api/auth/register", {
    username: newUsername.toLowerCase(),
    password,
    email: `${newUsername.toLowerCase()}-conflict@example.test`,
  });
  expect(result.response.status === 409, "case-insensitive duplicate registration is rejected", result.data);

  console.log("RESULT username API smoke passed");
} finally {
  if (userId) {
    await database.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {});
  }
  await database.query(
    `DELETE FROM username_history WHERE normalized_username = ANY($1::text[])`,
    [[oldUsername.toLowerCase(), newUsername.toLowerCase()]],
  ).catch(() => {});
  await database.end();
}
