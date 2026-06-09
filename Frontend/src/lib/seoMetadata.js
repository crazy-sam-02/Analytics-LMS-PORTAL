export const SITE_URL = "https://lms.analyticsedify.com";
export const LOGO_URL = `${SITE_URL}/analytics-logo-final.png`;
export const TWITTER_HANDLE = "@analyticsedify";
export const COMPANY_LEGAL_NAME = "Analytics Edifying Solutions Private Limited";
export const COMPANY_INCORPORATED_DATE = "2017-07-20";

export const STUDENT_LOGIN_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: "Analytics Edify",
  legalName: COMPANY_LEGAL_NAME,
  alternateName: ["Analytics LMS", "Analytics Edify LMS"],
  url: SITE_URL,
  logo: LOGO_URL,
  foundingDate: COMPANY_INCORPORATED_DATE,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Chennai",
    addressRegion: "Tamil Nadu",
    addressCountry: "IN",
  },
  areaServed: {
    "@type": "Country",
    name: "India",
  },
  identifier: {
    "@type": "PropertyValue",
    propertyID: "Registrar of Companies",
    value: "Chennai, Tamil Nadu",
  },
  description:
    "Analytics Edify LMS is operated by Analytics Edifying Solutions Private Limited, an Indian private limited company incorporated on July 20, 2017 and registered with the Registrar of Companies in Chennai, Tamil Nadu. It provides aptitude, coding, communication, and placement training for college students.",
  sameAs: ["https://analyticsedify.com"],
};

export const LOGIN_SEO = {
  student: {
    title: "Student Login | Analytics Edify LMS",
    description:
      "Student portal for Analytics Edify LMS by Analytics Edifying Solutions Private Limited, Chennai, for courses, tests, and placement prep.",
    keywords:
      "Analytics Edifying Solutions Private Limited, Analytics Edify LMS, Analytics LMS student login, Chennai LMS, Tamil Nadu LMS, student portal, online test portal, placement preparation",
    canonicalUrl: `${SITE_URL}/login`,
    robots: "index, follow",
    ogTitle: "Student Login | Analytics Edify LMS",
    ogDescription:
      "Access courses, aptitude tests, and placement preparation from Analytics Edify LMS, operated by Analytics Edifying Solutions Private Limited.",
    ogUrl: `${SITE_URL}/login`,
    structuredData: STUDENT_LOGIN_STRUCTURED_DATA,
  },
  admin: {
    title: "Admin Login | Analytics LMS",
    description:
      "Admin portal login for Analytics LMS — manage students, content, and platform settings.",
    keywords:
      "Analytics LMS admin login, Analytics LMS admin portal, college LMS admin, assessment management portal",
    canonicalUrl: `${SITE_URL}/admin/login`,
    robots: "noindex, nofollow",
    ogTitle: "Admin Login | Analytics LMS",
    ogDescription:
      "Analytics LMS admin portal. Manage students, content, and settings.",
    ogUrl: `${SITE_URL}/admin/login`,
  },
  collegeAdmin: {
    title: "College Admin Login | Analytics LMS",
    description:
      "College administrator login for Analytics LMS — manage your institution's students and performance.",
    keywords:
      "Analytics LMS college admin login, college admin portal, institutional LMS analytics",
    canonicalUrl: `${SITE_URL}/college-admin/login`,
    robots: "noindex, nofollow",
    ogTitle: "College Admin Login | Analytics LMS",
    ogDescription:
      "College admin portal for Analytics LMS. Manage institutional students and analytics.",
    ogUrl: `${SITE_URL}/college-admin/login`,
  },
  superAdmin: {
    title: "Super Admin Login | Analytics LMS",
    description:
      "Super admin login for Analytics LMS — platform-wide supervision and management.",
    keywords:
      "Analytics LMS super admin, Analytics LMS super admin portal, LMS platform admin, global LMS analytics",
    canonicalUrl: `${SITE_URL}/super-admin/login`,
    robots: "noindex, nofollow",
    ogTitle: "Super Admin Login | Analytics LMS",
    ogDescription:
      "Analytics LMS super admin portal for platform-level control and oversight.",
    ogUrl: `${SITE_URL}/super-admin/login`,
  },
};

export const DEFAULT_SEO = LOGIN_SEO.student;
