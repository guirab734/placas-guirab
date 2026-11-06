declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_PASSWORD_HASH?: string;
    ADMIN_RATE_KEY?: string;
    ADMIN_OWNER_ID?: string;
    PUBLIC_REDIRECTS?: string;
    GOOGLE_PLACES_API_KEY?: string;
  }
}
