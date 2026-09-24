export type DialCodeOption = {
  name: string;
  code: string;
  iso: string;
};

export const COUNTRY_DIAL_CODES: DialCodeOption[] = [
  { name: "Afghanistan", code: "+93", iso: "AF" }, { name: "Albania", code: "+355", iso: "AL" }, { name: "Algeria", code: "+213", iso: "DZ" }, { name: "American Samoa", code: "+1684", iso: "AS" },
  { name: "Andorra", code: "+376", iso: "AD" }, { name: "Angola", code: "+244", iso: "AO" }, { name: "Anguilla", code: "+1264", iso: "AI" }, { name: "Antigua and Barbuda", code: "+1268", iso: "AG" },
  { name: "Argentina", code: "+54", iso: "AR" }, { name: "Armenia", code: "+374", iso: "AM" }, { name: "Aruba", code: "+297", iso: "AW" }, { name: "Australia", code: "+61", iso: "AU" },
  { name: "Austria", code: "+43", iso: "AT" }, { name: "Azerbaijan", code: "+994", iso: "AZ" }, { name: "Bahamas", code: "+1242", iso: "BS" }, { name: "Bahrain", code: "+973", iso: "BH" },
  { name: "Bangladesh", code: "+880", iso: "BD" }, { name: "Barbados", code: "+1246", iso: "BB" }, { name: "Belarus", code: "+375", iso: "BY" }, { name: "Belgium", code: "+32", iso: "BE" },
  { name: "Belize", code: "+501", iso: "BZ" }, { name: "Benin", code: "+229", iso: "BJ" }, { name: "Bermuda", code: "+1441", iso: "BM" }, { name: "Bhutan", code: "+975", iso: "BT" },
  { name: "Bolivia", code: "+591", iso: "BO" }, { name: "Bosnia and Herzegovina", code: "+387", iso: "BA" }, { name: "Botswana", code: "+267", iso: "BW" }, { name: "Brazil", code: "+55", iso: "BR" },
  { name: "British Virgin Islands", code: "+1284", iso: "VG" }, { name: "Brunei", code: "+673", iso: "BN" }, { name: "Bulgaria", code: "+359", iso: "BG" }, { name: "Burkina Faso", code: "+226", iso: "BF" },
  { name: "Burundi", code: "+257", iso: "BI" }, { name: "Cambodia", code: "+855", iso: "KH" }, { name: "Cameroon", code: "+237", iso: "CM" }, { name: "Canada", code: "+1", iso: "CA" },
  { name: "Cape Verde", code: "+238", iso: "CV" }, { name: "Cayman Islands", code: "+1345", iso: "KY" }, { name: "Central African Republic", code: "+236", iso: "CF" }, { name: "Chad", code: "+235", iso: "TD" },
  { name: "Chile", code: "+56", iso: "CL" }, { name: "China", code: "+86", iso: "CN" }, { name: "Colombia", code: "+57", iso: "CO" }, { name: "Comoros", code: "+269", iso: "KM" },
  { name: "Congo", code: "+242", iso: "CG" }, { name: "Cook Islands", code: "+682", iso: "CK" }, { name: "Costa Rica", code: "+506", iso: "CR" }, { name: "Croatia", code: "+385", iso: "HR" },
  { name: "Cuba", code: "+53", iso: "CU" }, { name: "Curacao", code: "+599", iso: "CW" }, { name: "Cyprus", code: "+357", iso: "CY" }, { name: "Czech Republic", code: "+420", iso: "CZ" },
  { name: "Democratic Republic of the Congo", code: "+243", iso: "CD" }, { name: "Denmark", code: "+45", iso: "DK" }, { name: "Djibouti", code: "+253", iso: "DJ" }, { name: "Dominica", code: "+1767", iso: "DM" },
  { name: "Dominican Republic", code: "+1809", iso: "DO" }, { name: "Ecuador", code: "+593", iso: "EC" }, { name: "Egypt", code: "+20", iso: "EG" }, { name: "El Salvador", code: "+503", iso: "SV" },
  { name: "Equatorial Guinea", code: "+240", iso: "GQ" }, { name: "Eritrea", code: "+291", iso: "ER" }, { name: "Estonia", code: "+372", iso: "EE" }, { name: "Ethiopia", code: "+251", iso: "ET" },
  { name: "Falkland Islands", code: "+500", iso: "FK" }, { name: "Faroe Islands", code: "+298", iso: "FO" }, { name: "Fiji", code: "+679", iso: "FJ" }, { name: "Finland", code: "+358", iso: "FI" },
  { name: "France", code: "+33", iso: "FR" }, { name: "French Guiana", code: "+594", iso: "GF" }, { name: "French Polynesia", code: "+689", iso: "PF" }, { name: "Gabon", code: "+241", iso: "GA" },
  { name: "Gambia", code: "+220", iso: "GM" }, { name: "Georgia", code: "+995", iso: "GE" }, { name: "Germany", code: "+49", iso: "DE" }, { name: "Ghana", code: "+233", iso: "GH" },
  { name: "Gibraltar", code: "+350", iso: "GI" }, { name: "Greece", code: "+30", iso: "GR" }, { name: "Greenland", code: "+299", iso: "GL" }, { name: "Grenada", code: "+1473", iso: "GD" },
  { name: "Guadeloupe", code: "+590", iso: "GP" }, { name: "Guam", code: "+1671", iso: "GU" }, { name: "Guatemala", code: "+502", iso: "GT" }, { name: "Guernsey", code: "+44", iso: "GG" },
  { name: "Guinea", code: "+224", iso: "GN" }, { name: "Guinea-Bissau", code: "+245", iso: "GW" }, { name: "Guyana", code: "+592", iso: "GY" }, { name: "Haiti", code: "+509", iso: "HT" },
  { name: "Honduras", code: "+504", iso: "HN" }, { name: "Hong Kong", code: "+852", iso: "HK" }, { name: "Hungary", code: "+36", iso: "HU" }, { name: "Iceland", code: "+354", iso: "IS" },
  { name: "India", code: "+91", iso: "IN" }, { name: "Indonesia", code: "+62", iso: "ID" }, { name: "Iran", code: "+98", iso: "IR" }, { name: "Iraq", code: "+964", iso: "IQ" },
  { name: "Ireland", code: "+353", iso: "IE" }, { name: "Isle of Man", code: "+44", iso: "IM" }, { name: "Israel", code: "+972", iso: "IL" }, { name: "Italy", code: "+39", iso: "IT" },
  { name: "Ivory Coast", code: "+225", iso: "CI" }, { name: "Jamaica", code: "+1876", iso: "JM" }, { name: "Japan", code: "+81", iso: "JP" }, { name: "Jersey", code: "+44", iso: "JE" },
  { name: "Jordan", code: "+962", iso: "JO" }, { name: "Kazakhstan", code: "+7", iso: "KZ" }, { name: "Kenya", code: "+254", iso: "KE" }, { name: "Kiribati", code: "+686", iso: "KI" },
  { name: "Kosovo", code: "+383", iso: "XK" }, { name: "Kuwait", code: "+965", iso: "KW" }, { name: "Kyrgyzstan", code: "+996", iso: "KG" }, { name: "Laos", code: "+856", iso: "LA" },
  { name: "Latvia", code: "+371", iso: "LV" }, { name: "Lebanon", code: "+961", iso: "LB" }, { name: "Lesotho", code: "+266", iso: "LS" }, { name: "Liberia", code: "+231", iso: "LR" },
  { name: "Libya", code: "+218", iso: "LY" }, { name: "Liechtenstein", code: "+423", iso: "LI" }, { name: "Lithuania", code: "+370", iso: "LT" }, { name: "Luxembourg", code: "+352", iso: "LU" },
  { name: "Macau", code: "+853", iso: "MO" }, { name: "Madagascar", code: "+261", iso: "MG" }, { name: "Malawi", code: "+265", iso: "MW" }, { name: "Malaysia", code: "+60", iso: "MY" },
  { name: "Maldives", code: "+960", iso: "MV" }, { name: "Mali", code: "+223", iso: "ML" }, { name: "Malta", code: "+356", iso: "MT" }, { name: "Marshall Islands", code: "+692", iso: "MH" },
  { name: "Martinique", code: "+596", iso: "MQ" }, { name: "Mauritania", code: "+222", iso: "MR" }, { name: "Mauritius", code: "+230", iso: "MU" }, { name: "Mayotte", code: "+262", iso: "YT" },
  { name: "Mexico", code: "+52", iso: "MX" }, { name: "Micronesia", code: "+691", iso: "FM" }, { name: "Moldova", code: "+373", iso: "MD" }, { name: "Monaco", code: "+377", iso: "MC" },
  { name: "Mongolia", code: "+976", iso: "MN" }, { name: "Montenegro", code: "+382", iso: "ME" }, { name: "Montserrat", code: "+1664", iso: "MS" }, { name: "Morocco", code: "+212", iso: "MA" },
  { name: "Mozambique", code: "+258", iso: "MZ" }, { name: "Myanmar", code: "+95", iso: "MM" }, { name: "Namibia", code: "+264", iso: "NA" }, { name: "Nauru", code: "+674", iso: "NR" },
  { name: "Nepal", code: "+977", iso: "NP" }, { name: "Netherlands", code: "+31", iso: "NL" }, { name: "New Caledonia", code: "+687", iso: "NC" }, { name: "New Zealand", code: "+64", iso: "NZ" },
  { name: "Nicaragua", code: "+505", iso: "NI" }, { name: "Niger", code: "+227", iso: "NE" }, { name: "Nigeria", code: "+234", iso: "NG" }, { name: "Niue", code: "+683", iso: "NU" },
  { name: "North Korea", code: "+850", iso: "KP" }, { name: "North Macedonia", code: "+389", iso: "MK" }, { name: "Northern Mariana Islands", code: "+1670", iso: "MP" }, { name: "Norway", code: "+47", iso: "NO" },
  { name: "Oman", code: "+968", iso: "OM" }, { name: "Pakistan", code: "+92", iso: "PK" }, { name: "Palau", code: "+680", iso: "PW" }, { name: "Palestine", code: "+970", iso: "PS" },
  { name: "Panama", code: "+507", iso: "PA" }, { name: "Papua New Guinea", code: "+675", iso: "PG" }, { name: "Paraguay", code: "+595", iso: "PY" }, { name: "Peru", code: "+51", iso: "PE" },
  { name: "Philippines", code: "+63", iso: "PH" }, { name: "Poland", code: "+48", iso: "PL" }, { name: "Portugal", code: "+351", iso: "PT" }, { name: "Puerto Rico", code: "+1787", iso: "PR" },
  { name: "Qatar", code: "+974", iso: "QA" }, { name: "Reunion", code: "+262", iso: "RE" }, { name: "Romania", code: "+40", iso: "RO" }, { name: "Russia", code: "+7", iso: "RU" },
  { name: "Rwanda", code: "+250", iso: "RW" }, { name: "Saint Barthelemy", code: "+590", iso: "BL" }, { name: "Saint Helena", code: "+290", iso: "SH" }, { name: "Saint Kitts and Nevis", code: "+1869", iso: "KN" },
  { name: "Saint Lucia", code: "+1758", iso: "LC" }, { name: "Saint Martin", code: "+590", iso: "MF" }, { name: "Saint Pierre and Miquelon", code: "+508", iso: "PM" }, { name: "Saint Vincent and the Grenadines", code: "+1784", iso: "VC" },
  { name: "Samoa", code: "+685", iso: "WS" }, { name: "San Marino", code: "+378", iso: "SM" }, { name: "Sao Tome and Principe", code: "+239", iso: "ST" }, { name: "Saudi Arabia", code: "+966", iso: "SA" },
  { name: "Senegal", code: "+221", iso: "SN" }, { name: "Serbia", code: "+381", iso: "RS" }, { name: "Seychelles", code: "+248", iso: "SC" }, { name: "Sierra Leone", code: "+232", iso: "SL" },
  { name: "Singapore", code: "+65", iso: "SG" }, { name: "Sint Maarten", code: "+1721", iso: "SX" }, { name: "Slovakia", code: "+421", iso: "SK" }, { name: "Slovenia", code: "+386", iso: "SI" },
  { name: "Solomon Islands", code: "+677", iso: "SB" }, { name: "Somalia", code: "+252", iso: "SO" }, { name: "South Africa", code: "+27", iso: "ZA" }, { name: "South Korea", code: "+82", iso: "KR" },
  { name: "South Sudan", code: "+211", iso: "SS" }, { name: "Spain", code: "+34", iso: "ES" }, { name: "Sri Lanka", code: "+94", iso: "LK" }, { name: "Sudan", code: "+249", iso: "SD" },
  { name: "Suriname", code: "+597", iso: "SR" }, { name: "Swaziland", code: "+268", iso: "SZ" }, { name: "Sweden", code: "+46", iso: "SE" }, { name: "Switzerland", code: "+41", iso: "CH" },
  { name: "Syria", code: "+963", iso: "SY" }, { name: "Taiwan", code: "+886", iso: "TW" }, { name: "Tajikistan", code: "+992", iso: "TJ" }, { name: "Tanzania", code: "+255", iso: "TZ" },
  { name: "Thailand", code: "+66", iso: "TH" }, { name: "Timor-Leste", code: "+670", iso: "TL" }, { name: "Togo", code: "+228", iso: "TG" }, { name: "Tokelau", code: "+690", iso: "TK" },
  { name: "Tonga", code: "+676", iso: "TO" }, { name: "Trinidad and Tobago", code: "+1868", iso: "TT" }, { name: "Tunisia", code: "+216", iso: "TN" }, { name: "Turkey", code: "+90", iso: "TR" },
  { name: "Turkmenistan", code: "+993", iso: "TM" }, { name: "Turks and Caicos Islands", code: "+1649", iso: "TC" }, { name: "Tuvalu", code: "+688", iso: "TV" }, { name: "Uganda", code: "+256", iso: "UG" },
  { name: "Ukraine", code: "+380", iso: "UA" }, { name: "United Arab Emirates", code: "+971", iso: "AE" }, { name: "United Kingdom", code: "+44", iso: "GB" }, { name: "United States", code: "+1", iso: "US" },
  { name: "Uruguay", code: "+598", iso: "UY" }, { name: "Uzbekistan", code: "+998", iso: "UZ" }, { name: "Vanuatu", code: "+678", iso: "VU" }, { name: "Vatican City", code: "+39", iso: "VA" },
  { name: "Venezuela", code: "+58", iso: "VE" }, { name: "Vietnam", code: "+84", iso: "VN" }, { name: "Wallis and Futuna", code: "+681", iso: "WF" }, { name: "Yemen", code: "+967", iso: "YE" },
  { name: "Zambia", code: "+260", iso: "ZM" }, { name: "Zimbabwe", code: "+263", iso: "ZW" }
];

export function normalizePhoneNumber(dialCode: string, phone: string): string {
  const raw = phone.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) {
    return `+${raw.slice(1).replace(/\D/g, "")}`;
  }
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `${dialCode}${digits}` : "";
}

/**
 * Accepts Iranian mobile numbers in every common spelling —
 * 09123456789 / +989123456789 / 00989123456789 / 989123456789 /
 * 9123456789, with spaces, dashes, dots or Persian digits anywhere.
 * Returns the canonical 09XXXXXXXXX form or "" when it is not one.
 */
export function normalizeIranianMobile(phone: string): string {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const latinized = raw.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = persianDigits.indexOf(ch);
    if (p > -1) return String(p);
    return String(arabicDigits.indexOf(ch));
  });
  let digits = latinized.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("098")) digits = digits.slice(3);
  else if (digits.startsWith("98") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
  return /^09\d{9}$/.test(digits) ? digits : "";
}
