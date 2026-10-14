/**
 * Location acquisition + share helpers.
 * All calls are consent-driven: permission is requested explicitly and the
 * user can deny; failures return null instead of throwing into the SOS flow.
 */

import * as Location from 'expo-location';
import { Linking } from 'react-native';

import type { GeoLocationFix } from '@/core/types';

export interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

export async function checkLocationPermission(): Promise<LocationPermissionState> {
  const current = await Location.getForegroundPermissionsAsync();
  return {
    granted: current.granted,
    canAskAgain: current.canAskAgain,
    status: current.status,
  };
}

export async function requestLocationPermission(): Promise<LocationPermissionState> {
  const response = await Location.requestForegroundPermissionsAsync();
  return {
    granted: response.granted,
    canAskAgain: response.canAskAgain,
    status: response.status,
  };
}

/**
 * Best-effort current fix: tries a high-accuracy fresh position, falls back to
 * the last known position. Returns null when permission is denied or location
 * services are off — the SOS alert is still sent (without coordinates).
 */
export async function getCurrentFix(): Promise<GeoLocationFix | null> {
  const permission = await checkLocationPermission();
  if (!permission.granted) return null;

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return toFix(position);
  } catch {
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      return last ? toFix(last) : null;
    } catch {
      return null;
    }
  }
}

function toFix(position: Location.LocationObject): GeoLocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy ?? null,
    altitudeMeters: position.coords.altitude ?? null,
    timestamp: position.timestamp,
  };
}

/** Universal shareable link (opens Apple/Google Maps or geo: on Android). */
export function buildShareLink(fix: GeoLocationFix): string {
  return `https://maps.google.com/?q=${fix.latitude.toFixed(6)},${fix.longitude.toFixed(6)}`;
}

export function buildGeoLink(fix: GeoLocationFix): string {
  return `geo:${fix.latitude},${fix.longitude}`;
}

/** OpenStreetMap static preview image (no API key required). */
export function buildOsmPreviewUrl(fix: GeoLocationFix, width = 640, height = 360): string {
  const zoom = 16;
  const scale = 1;
  return (
    `https://staticmap.openstreetmap.de/staticmap.php` +
    `?center=${fix.latitude},${fix.longitude}&zoom=${zoom}` +
    `&size=${width}x${height}&scale=${scale}&markers=${fix.latitude},${fix.longitude},red-pushpin`
  );
}

export async function openInMaps(fix: GeoLocationFix): Promise<void> {
  const geo = buildGeoLink(fix);
  const web = buildShareLink(fix);
  try {
    await Linking.openURL(geo);
  } catch {
    await Linking.openURL(web);
  }
}
