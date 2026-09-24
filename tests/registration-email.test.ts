import test from "node:test";
import assert from "node:assert/strict";
import { schemas } from "../server/utils/validation";
import { getRegistrationErrors } from "../src/utils/registrationValidation";

const validRegistration = {
  username: "Reader_42",
  password: "Correct-Horse-42!",
  email: "Reader@Gmail.com",
  nickname: "Reader",
  phone: null,
};

test("registration requires and normalizes a permanent email address", () => {
  assert.equal(schemas.register.safeParse({ ...validRegistration, email: "" }).success, false);

  const parsed = schemas.register.parse(validRegistration);
  assert.equal(parsed.email, "reader@gmail.com");
});

test("server registration rejects maintained-list and common disposable domains", () => {
  for (const email of [
    "person@mailinator.com",
    "person@sub.mailinator.com",
    "person@yopmail.com",
    "person@0-mail.com",
  ]) {
    const result = schemas.register.safeParse({ ...validRegistration, email });
    assert.equal(result.success, false, `${email} should be rejected`);
    if (!result.success) assert.match(result.error.issues[0]?.message || "", /temporary email/i);
  }
});

test("domain matching does not use unsafe substring checks", () => {
  const result = schemas.register.safeParse({
    ...validRegistration,
    email: "person@real-mailinator-company.example",
  });
  assert.equal(result.success, true);
});

test("browser registration validation gives immediate disposable-email feedback", () => {
  const errors = getRegistrationErrors({
    nickname: "Reader",
    username: "Reader_42",
    email: "person@yopmail.com",
    password: "Correct-Horse-42!",
    repeatPassword: "Correct-Horse-42!",
    acceptedRules: true,
  });
  assert.ok(errors.some((error) => /temporary email/i.test(error)));
});
