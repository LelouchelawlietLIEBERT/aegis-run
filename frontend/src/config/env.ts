const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const rawApiKey = import.meta.env.VITE_API_KEY ?? "";

export const env = {
  apiBaseUrl: rawBaseUrl.replace(/\/+$/, ""),
  apiKey: rawApiKey,
  configured: rawBaseUrl.length > 0 && rawApiKey.length > 0,
} as const;
