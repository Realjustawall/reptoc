import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { DISPOSABLE_EMAIL_ERROR } from '../../shared/emailValidation';
import { isDisposableRegistrationEmail } from './emailDomains';

const registrationEmailSchema = z.string({ error: "ایمیل الزامی است" })
  .trim()
  .min(1, "ایمیل الزامی است")
  .email("آدرس ایمیل معتبر نیست")
  .max(255, "آدرس ایمیل نباید بیش از 255 نویسه باشد")
  .transform((email) => email.toLowerCase())
  .refine((email) => !isDisposableRegistrationEmail(email), DISPOSABLE_EMAIL_ERROR);

/**
 * Accepts Iranian mobile numbers in every common spelling —
 * 09123456789 / +989123456789 / 00989123456789 / 989123456789 /
 * 9123456789, with spaces, dashes, dots or parentheses anywhere.
 * Everything normalizes to the canonical 09XXXXXXXXX form.
 */
export function normalizeIranianMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Persian/Arabic digits → Latin, then drop everything that is not a digit.
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const latinized = value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = persianDigits.indexOf(ch);
    if (p > -1) return String(p);
    return String(arabicDigits.indexOf(ch));
  });
  let digits = latinized.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("098")) digits = digits.slice(3);
  else if (digits.startsWith("98") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

function iranianMobileSchema() {
  return z.preprocess((value) => {
    if (typeof value !== "string" || value.trim() === "") return null;
    return normalizeIranianMobile(value);
  }, z.string().regex(/^09\d{9}$/, "شماره موبایل باید یک شماره ایران باشد؛ مثلاً 09123456789").nullable().optional());
}

// Schema for different operations
export const schemas = {
  register: z.object({
    username: z.string({ error: "نام کاربری الزامی است" })
      .min(3, "نام کاربری باید حداقل 3 نویسه باشد")
      .max(30, "نام کاربری نباید بیش از 30 نویسه باشد")
      .regex(/^[a-zA-Z0-9_]+$/, "نام کاربری فقط می‌تواند شامل حروف لاتین، اعداد و زیرخط باشد"),
    password: z.string({ error: "رمز عبور الزامی است" })
      .min(12, "رمز عبور باید حداقل 12 نویسه باشد")
      .max(128, "رمز عبور نباید بیش از 128 نویسه باشد")
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, "رمز عبور باید شامل یک حرف بزرگ، یک حرف کوچک، یک عدد و یک نویسه ویژه باشد"),
    email: z.preprocess(
      (value) => typeof value === "string" ? value.trim() : value,
      registrationEmailSchema
    ),
    phone: iranianMobileSchema(),
    nickname: z.string().min(1, "نام مستعار نمی‌تواند خالی باشد").max(50, "نام مستعار نباید بیش از 50 نویسه باشد").optional().nullable(),
  }),
  
  login: z.object({
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().optional()
  }),

  passwordResetRequest: z.object({
    email: z.string().trim().email().max(255)
  }),

  passwordResetConfirm: z.object({
    email: z.string().trim().email().max(255),
    code: z.string().trim().regex(/^\d{6}$/, "کد بازنشانی باید 6 رقم باشد"),
    newPassword: z.string()
      .min(12)
      .max(128)
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, "رمز عبور باید شامل حرف بزرگ، حرف کوچک، عدد و نویسه ویژه باشد")
  }),

  profileIdentity: z.object({
    email: z.preprocess(
      (value) => typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().email().max(255).nullable()
    ),
    phone: z.preprocess(
      (value) => typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().max(40).regex(/^\+?[0-9][0-9\s().-]*$/, "قالب شماره تلفن نامعتبر است").nullable()
    ),
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80)
  }),

  usernameChange: z.object({
    username: z.string({ error: "نام کاربری الزامی است" })
      .trim()
      .min(3, "نام کاربری باید حداقل 3 نویسه باشد")
      .max(30, "نام کاربری نباید بیش از 30 نویسه باشد")
      .regex(/^[a-zA-Z0-9_]+$/, "نام کاربری فقط می‌تواند شامل حروف لاتین، اعداد و زیرخط باشد"),
  }),
  
  novel: z.object({
    id: z.string().uuid().optional(),  // ✅ Make optional for create operations
    title: z.string().min(1).max(160),  // ✅ Increased max per schema
    author: z.string().min(1).max(80),  // ✅ Increased max
    description: z.string().max(5000).optional(),
    genre: z.string().max(100).optional(),  // ✅ Add max length
    coverUrl: z.string().url().max(2048).optional(),  // ✅ Add max length
  }),
  
  review: z.object({
    rating: z.number().min(1).max(5).int(),  // ✅ Add int validation
    comment: z.string().min(1).max(5000),  // ✅ Increased max
  }),
  
  thread: z.object({
    category: z.string().max(100).optional(),  // ✅ Increased max
    title: z.string().min(3).max(200),  // ✅ Increased max
    content: z.string().min(1).max(50000)  // ✅ Increased for long-form content
  }),
  
  post: z.object({
    content: z.string().min(1).max(50000)  // ✅ Increased max
  })
};

// Validation middleware
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const zodErr = error as any;
        const details = (zodErr.issues || zodErr.errors || [])
          .map((e: any) => ({
            field: e.path.join('.'),
            message: e.message
          }));
        
        const fieldLabels: Record<string, string> = {
          username: "نام کاربری",
          password: "رمز عبور",
          email: "ایمیل",
          phone: "شماره تلفن",
          nickname: "نام مستعار"
        };
        const errorMessage = details
          .map((detail: { field: string; message: string }) => {
            const label = fieldLabels[detail.field] || detail.field || "ورودی";
            return detail.message.toLowerCase().startsWith(label.toLowerCase())
              ? detail.message
              : `${label}: ${detail.message}`;
          })
          .join(" ");

        res.status(400).json({
          error: errorMessage || "ورودی ارسالی نامعتبر است.",
          details
        });
        return;
      }
      next(error);
    }
  };
}
