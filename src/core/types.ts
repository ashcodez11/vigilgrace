/**
 * Domain types shared across the VigilGrace app.
 * This module is pure TypeScript with no React Native imports so it can be
 * unit-tested in Node (vitest) and reused by tooling.
 */

export type SosTriggerSource = 'manual' | 'shake' | 'voice' | 'test';

export type SosStatus =
  | 'idle'
  | 'countdown'
  | 'sending'
  | 'retrying'
  | 'awaiting-confirmation'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export type DeliveryChannel = 'sms' | 'call' | 'push' | 'webhook';

export type DeliveryState =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'simulated';

export interface EmergencyContact {
  id: string;
  name: string;
  /** Raw phone number as entered by the user (digits / +). */
  phone: string;
  relation?: string;
  verified: boolean;
  verifyRequestedAt?: string;
  createdAt: string;
}

export interface ContactSeed {
  name: string;
  phone: string;
  relation?: string;
}

export interface GeoLocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  timestamp: number;
}

export interface EmergencyAlertPayload {
  alertId: string;
  userId: string;
  createdAt: string;
  trigger: SosTriggerSource;
  location: GeoLocationFix | null;
  message: string;
  /** Free-form signal confidences, e.g. { shake: 0.9, voice: 0.4 }. */
  signals?: Record<string, number>;
  evidence?: EvidenceMetadata[];
}

export interface ContactDeliveryResult {
  contactId: string;
  contactName: string;
  channel: DeliveryChannel;
  state: DeliveryState;
  detail?: string;
}

export interface AlertDeliveryReport {
  alertId: string;
  status: SosStatus;
  deliveryMode: 'mock' | 'twilio' | 'webhook' | 'unknown';
  results: ContactDeliveryResult[];
  updatedAt: string;
}

export interface EvidenceMetadata {
  id: string;
  kind: 'audio' | 'location-snapshot' | 'note';
  createdAt: string;
  /** SHA-256 digest of the evidence artifact (base64; legacy hex also accepted). */
  sha256: string;
  /** Local file URI (app-private storage) when applicable. */
  localUri?: string;
  /** True when the artifact bytes were uploaded anywhere. False = metadata only. */
  uploaded: boolean;
  contentType?: string;
  sizeBytes?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  mlKemPublicKeyB64?: string;
  mlDsaPublicKeyB64?: string;
}

export type ImplementationStatus =
  | 'implemented'
  | 'prototype'
  | 'requires-dev-build'
  | 'requires-hardware'
  | 'not-implemented';

export interface FeatureStatus {
  key: string;
  title: string;
  status: ImplementationStatus;
  summary: string;
}
