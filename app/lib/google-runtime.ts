import { env } from "cloudflare:workers";
import { googlePlaceProfile as lookup, reviewLinkWithOptionalProfile as resolve } from "./places-profile";

// The optional key stays in the server runtime and is transmitted only in the official API header.
export const googlePlaceProfile = (value: unknown) => lookup(value, fetch, env.GOOGLE_PLACES_API_KEY);
export const reviewLinkWithOptionalProfile = (value: unknown) => resolve(value, fetch, env.GOOGLE_PLACES_API_KEY);
