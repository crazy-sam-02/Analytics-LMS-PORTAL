import { useEffect } from "react";

const DEFAULT_TITLE = "Analytics LMS | Analystics LMS Portal";
const DEFAULT_DESCRIPTION = "Secure LMS portal for students, college admins, super admins, online tests, and analytics.";

const ensureMeta = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }
  return element;
};

const setMetaContent = (selector, attributes, content) => {
  const element = ensureMeta(selector, attributes);
  element.setAttribute("content", content);
};

export const useSeo = ({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  keywords = "Analystics LMS, Analytics LMS, LMS portal, student portal, admin portal, online test platform",
} = {}) => {
  useEffect(() => {
    document.title = title;

    setMetaContent('meta[name="description"]', { name: "description" }, description);
    setMetaContent('meta[name="keywords"]', { name: "keywords" }, keywords);
    setMetaContent('meta[property="og:title"]', { property: "og:title" }, title);
    setMetaContent('meta[property="og:description"]', { property: "og:description" }, description);
    setMetaContent('meta[name="twitter:title"]', { name: "twitter:title" }, title);
    setMetaContent('meta[name="twitter:description"]', { name: "twitter:description" }, description);

    const canonicalHref = window.location.href;
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", canonicalHref);
  }, [description, keywords, title]);
};
