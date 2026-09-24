import { DISPOSABLE_EMAIL_ERROR, isCommonDisposableEmail } from "../../shared/emailValidation";
import { normalizeIranianMobile } from "./phone";

export type RegistrationInput = {
  nickname: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  repeatPassword: string;
  acceptedRules: boolean;
};

export function getRegistrationErrors(input: RegistrationInput): string[] {
  const errors: string[] = [];
  const nickname = input.nickname.trim();
  const username = input.username.trim();
  const email = input.email.trim();
  const phone = (input.phone || "").trim();

  if (!nickname) errors.push("نام مستعار: این فیلد الزامی است.");
  else if (nickname.length > 50) errors.push("نام مستعار: نباید بیش از 50 کاراکتر باشد.");

  if (!username) errors.push("نام کاربری: این فیلد الزامی است.");
  else {
    if (username.length < 3) errors.push("نام کاربری: باید حداقل 3 کاراکتر باشد.");
    if (username.length > 30) errors.push("نام کاربری: نباید بیش از 30 کاراکتر باشد.");
    if (!/^[a-zA-Z0-9_]+$/.test(username)) errors.push("نام کاربری: فقط حروف، اعداد و زیرخط مجاز هستند.");
  }

  if (!email) errors.push("ایمیل: این فیلد الزامی است.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("ایمیل: یک نشانی ایمیل معتبر وارد کنید؛ مانند name@example.com.");
  else if (email.length > 255) errors.push("ایمیل: نباید بیش از 255 کاراکتر باشد.");
  else if (isCommonDisposableEmail(email)) errors.push(`ایمیل: ${DISPOSABLE_EMAIL_ERROR}`);

  if (phone && !normalizeIranianMobile(phone)) {
    errors.push("شماره موبایل: یک شماره موبایل ایران وارد کنید؛ مانند 09123456789.");
  }

  if (!input.password) errors.push("رمز عبور: این فیلد الزامی است.");
  else {
    if (input.password.length < 12) errors.push("رمز عبور: باید حداقل 12 کاراکتر باشد.");
    if (input.password.length > 128) errors.push("رمز عبور: نباید بیش از 128 کاراکتر باشد.");
    if (!/[A-Z]/.test(input.password)) errors.push("رمز عبور: حداقل یک حرف بزرگ اضافه کنید.");
    if (!/[a-z]/.test(input.password)) errors.push("رمز عبور: حداقل یک حرف کوچک اضافه کنید.");
    if (!/[0-9]/.test(input.password)) errors.push("رمز عبور: حداقل یک عدد اضافه کنید.");
    if (!/[^A-Za-z0-9]/.test(input.password)) errors.push("رمز عبور: حداقل یک کاراکتر ویژه اضافه کنید.");
  }

  if (!input.repeatPassword) errors.push("تکرار رمز عبور: این فیلد الزامی است.");
  else if (input.password !== input.repeatPassword) errors.push("تکرار رمز عبور: با رمز عبور مطابقت ندارد.");

  if (!input.acceptedRules) errors.push("قوانین: باید قوانین و شرایط استفاده از خدمات را بپذیرید.");
  return errors;
}
