<div align="center">

![Reptoc](docs/assets/banner-fa.svg)

**پلتفرم فارسی رمان و مانگا با فضای مطالعه و نویسندگی، امکانات اجتماعی، جهان‌سازی و مدیریت محتوا.**

<img alt="Version" src="https://img.shields.io/badge/version-%D8%B3%D9%88%D8%B1%D8%B3-b65aff?style=flat-square" />
<img alt="Platform" src="https://img.shields.io/badge/platform-Persian%20%2F%20RTL%20web-354158?style=flat-square" />
<a href="https://github.com/Realjustawall/reptoc/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/Realjustawall/reptoc/ci.yml?branch=main&amp;label=CI&amp;style=flat-square" /></a>

<a href="https://github.com/Realjustawall/reptoc/archive/refs/heads/main.zip"><img src="docs/assets/buttons/download-fa.svg" alt="دریافت نسخه" width="220" height="72" /></a>
<a href="docs/gallery.fa.md"><img src="docs/assets/buttons/demo-fa.svg" alt="مشاهدهٔ دمو" width="220" height="72" /></a>
<a href="#quick-start"><img src="docs/assets/buttons/start-fa.svg" alt="راه‌اندازی" width="220" height="72" /></a>
<a href="https://github.com/Realjustawall/reptoc/issues"><img src="docs/assets/buttons/issues-fa.svg" alt="گزارش اشکال" width="220" height="72" /></a>

[English](README.md) · [فارسی](README.fa.md)

</div>

---

[قابلیت‌های شاخص](#features) · [پیش‌نمایش](#preview) · [راه‌اندازی](#quick-start) · [توسعه](#development) · [مستندات](#documentation) · [امنیت و حریم خصوصی](#security) · [مجوز و بازخورد](#license)

<a id="features"></a>

## قابلیت‌های شاخص

| قابلیت | کاربرد |
|---|---|
| مطالعه | رمان، صفحات مانگا، نشانک، پیشرفت مطالعه و دریافت فصل برای مطالعهٔ آفلاین. |
| نویسندگی | محیط مدیریت رمان و فصل، ویرایش غنی، ابزار کاور و شخصیت. |
| جهان‌سازی | اطلاعات جهان، منابع، خط زمانی و ارتباط میان عناصر. |
| اجتماع | پروفایل کاربر و نویسنده، انجمن، چالش، دیدگاه و پیشنهاد اثر. |
| مدیریت | نظارت بر محتوا، آمار، ابزار پریمیوم و مدیریت مبتنی بر PostgreSQL. |

<a id="preview"></a>

## پیش‌نمایش

اطلاعات گالری نمایشی‌اند. صفحات وابسته به API با پاسخ آزمایشی محلی و صفحات آفلاین با دادهٔ نمونهٔ IndexedDB ثبت شده‌اند؛ حساب واقعی یا احراز هویت مبتنی بر PostgreSQL نمایش داده نمی‌شود.

![Reptoc — خانه](docs/assets/screenshots/fa/04-home-demo.webp)

<details>
<summary>تصاویر بیشتر</summary>

![Reptoc — پروفایل کاربری](docs/assets/screenshots/fa/09-profile-overview-demo.webp)

![Reptoc — کتابخانهٔ نشان‌شده‌ها](docs/assets/screenshots/fa/11-bookmarks-demo.webp)

![Reptoc — میز کار نویسنده](docs/assets/screenshots/fa/12-writing-workspace-demo.webp)

</details>

[مشاهدهٔ گالری کامل](docs/gallery.fa.md)

<a id="quick-start"></a>

## راه‌اندازی

از سرور تازهٔ اوبونتو ۲۲٫۰۴ یا ۲۴٫۰۴ و جدیدتر، یا دبیان ۱۲ و جدیدتر با دسترسی sudo استفاده کنید. حداقل ۲ گیگابایت رم لازم است؛ برای زمان ساخت، ۴ گیگابایت پیشنهاد می‌شود.

```bash
git clone https://github.com/Realjustawall/reptoc.git
cd reptoc
sudo ./install.sh
```

نصب‌کننده دامنه یا IP و حساب مالک را می‌پرسد، PostgreSQL را آماده می‌کند، مهاجرت‌ها و ساخت برنامه را انجام می‌دهد و سرویس و Nginx را تنظیم می‌کند. صدور گواهی HTTPS اختیاری است و به دسترسی شبکه و دامنه نیاز دارد. فایل موجود `/opt/reptoc/.env` بازنویسی نمی‌شود.

پیکربندی، پایگاه‌دادهٔ موجود، پشتیبان و نگهداری در [INSTALL.md](INSTALL.md) آمده است. استقرار و استفاده از پلتفرم به مجوز بیان‌شده در [LICENSE](LICENSE) نیاز دارد.

<a id="development"></a>

## توسعه

Node.js و npm و PostgreSQL لازم‌اند. پیش از اجرا، از `.env.example` کپی بگیرید و اتصال پایگاه‌داده و `ENCRYPTION_KEY` تصادفی و پایدار را تنظیم کنید.

```bash
cp .env.example .env
npm ci
# Configure .env and an empty development database first.
: "${DATABASE_URL:?Export the database URL configured in .env first}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres_suggestion_schema.sql
npm run db:migrate
npm run dev
```

دستورهای بررسی:

```bash
npm run lint
npm run test:worldbuilding
npm run build
```

<a id="documentation"></a>

## مستندات

- [نصب و نگهداری](INSTALL.md)
- [راهنمای پیاده‌سازی](IMPLEMENTATION_GUIDE.md)
- [جهان‌سازی و پریمیوم](WORLDBUILDING_AND_PREMIUM.md)
- [نسخهٔ حفظ‌شدهٔ مستندات پیشین](REFERENCE.md)

<a id="security"></a>

## امنیت و حریم خصوصی

فایل `.env`، خروجی پایگاه‌داده، پیوست کاربران و پشتیبان عملیاتی را وارد Git نکنید. کلید رمزگذاری تصادفی و پایدار و پشتیبان جداگانهٔ PostgreSQL و پیوست‌ها نگه دارید. داده‌های نمایشی گالری، مدرک ممیزی امنیتی سامانهٔ عملیاتی نیستند.

<a id="license"></a>

## مجوز و بازخورد

این پروژه سورس‌در‌دسترس است و مجوز متن‌باز ندارد. استقرار یا بهره‌برداری پلتفرم، بازتوزیع و دیگر استفاده‌های محفوظ به اجازه نیاز دارند؛ [LICENSE](LICENSE) را بخوانید.

[گزارش اشکال و پیشنهاد بهبود](https://github.com/Realjustawall/reptoc/issues). نسخه، سیستم‌عامل و روش بازتولید را بنویسید و اطلاعات خصوصی یا رمزها را در گزارش قرار ندهید.

---

نگهداری توسط **[Realjustawall](https://github.com/Realjustawall)**.
