// Where the backend lives. Override in .env.local if your port/prefix differs.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
  
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";