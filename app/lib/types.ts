export type Loja = {
  id: string;
  code: string;
  plateNumber: number | null;
  legacyCode: string | null;
  name: string;
  targetUrl: string;
  active: boolean;
  scans: number;
  lastAccess: string | null;
  joinedAt: string | null;
  initialReviews: number | null;
  currentReviews: number | null;
  reviewsUpdatedAt: string | null;
  ownerName: string;
  ownerPhone: string;
  address: string;
  neighborhood: string;
  notes: string;
  nextContactAt: string | null;
  googlePlaceId: string | null;
  googleProfileUrl: string | null;
  googleRating: number | null;
  latitude: number | null;
  longitude: number | null;
  googleSyncedAt: string | null;
  businessPhone: string;
  reviewSource: "manual" | "google";
  createdAt: string;
  updatedAt: string;
};

export type VisitGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "Streets"; streets: Array<{ id: string; name: string; coordinates: [number, number][] }> }
  | { type: "Brush"; strokes: Array<{ points: [number, number][]; radiusMeters: number; mode: "paint" | "erase" }> };

export type GooglePlaceProfile = {
  placeId: string;
  targetUrl: string;
  googleMapsUrl: string;
  name: string;
  address?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  reviewCount?: number;
  businessPhone?: string;
  fetchedAt: string;
};

export type Visit = {
  id: string;
  title: string;
  geometry: VisitGeometry;
  status: "visited" | "return" | "sold" | "not_interested";
  visitedAt: string;
  notes: string;
  address: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
