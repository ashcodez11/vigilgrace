/**
 * Typed wrappers around the VigilGrace backend REST API.
 */

import type { SealedEnvelope } from '@/core/crypto/envelope';
import type {
  AlertDeliveryReport,
  EmergencyContact,
  EvidenceMetadata,
  UserProfile,
} from '@/core/types';
import { apiFetch, ApiError } from './api';

export interface ServerCryptoInfo {
  kemPublicKeyB64: string;
  sigPublicKeyB64: string;
  algorithms: {
    kem: string;
    signature: string;
    aead: string;
    hash: string;
  };
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export function registerUser(email: string, password: string, name: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { email, password, name },
  });
}

export function loginUser(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export function fetchMe(token: string): Promise<{ user: UserProfile }> {
  return apiFetch('/auth/me', { token });
}

export function uploadPublicKeys(
  token: string,
  keys: { mlKemPublicKeyB64: string; mlDsaPublicKeyB64: string },
): Promise<{ ok: true }> {
  return apiFetch('/auth/keys', { method: 'POST', token, body: keys });
}

export function fetchServerCrypto(baseUrl?: string): Promise<ServerCryptoInfo> {
  // baseUrl override used only by the health/security screen before login
  if (!baseUrl) return apiFetch<ServerCryptoInfo>('/crypto/server-keys');
  return apiFetch<ServerCryptoInfo>(`${baseUrl}/crypto/server-keys`);
}

export interface ContactInput {
  name: string;
  phone: string;
  relation?: string;
}

export function listContacts(token: string): Promise<{ contacts: EmergencyContact[] }> {
  return apiFetch('/contacts', { token });
}

export function createContact(token: string, contact: ContactInput): Promise<{ contact: EmergencyContact }> {
  return apiFetch('/contacts', { method: 'POST', token, body: contact });
}

export function updateContact(
  token: string,
  id: string,
  contact: Partial<ContactInput>,
): Promise<{ contact: EmergencyContact }> {
  return apiFetch(`/contacts/${id}`, { method: 'PATCH', token, body: contact });
}

export function deleteContact(token: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/contacts/${id}`, { method: 'DELETE', token });
}

export interface SendVerifyResponse {
  delivery: 'mock' | 'twilio' | 'webhook' | 'unknown';
  /** Only returned when the backend runs in mock/dev mode. */
  devCode?: string;
}

export function requestContactVerification(token: string, id: string): Promise<SendVerifyResponse> {
  return apiFetch(`/contacts/${id}/send-verify`, { method: 'POST', token });
}

export function verifyContact(token: string, id: string, code: string): Promise<{ contact: EmergencyContact }> {
  return apiFetch(`/contacts/${id}/verify`, { method: 'POST', token, body: { code } });
}

export function submitAlertEnvelope(
  token: string,
  envelope: SealedEnvelope,
): Promise<{ accepted: true; report: AlertDeliveryReport; duplicate: boolean; retried?: boolean }> {
  // The server messages every verified contact before answering, so this one
  // gets a longer ceiling than ordinary calls — but a ceiling all the same. An
  // unbounded request used to leave the SOS screen on "Sending…" with no way
  // to retry while a socket hung.
  return apiFetch('/alerts', {
    method: 'POST',
    token,
    body: { envelope },
    timeoutMs: 20_000,
  });
}

export interface AlertSummary {
  id: string;
  status: string;
  trigger: string;
  createdAt: string;
  location: { latitude: number; longitude: number } | null;
  deliveryMode: string;
  payloadHashB64: string;
  evidence?: EvidenceMetadata[];
}

export function listAlerts(token: string, limit = 50): Promise<{ alerts: AlertSummary[] }> {
  return apiFetch(`/alerts?limit=${limit}`, { token });
}

export function fetchAlert(token: string, id: string): Promise<{ report: AlertDeliveryReport }> {
  return apiFetch(`/alerts/${id}`, { token });
}

/** Attach evidence METADATA (hashes) to an accepted alert. Audio bytes stay on-device. */
export function attachEvidence(
  token: string,
  alertId: string,
  records: EvidenceMetadata[],
): Promise<{ ok: true; evidence: EvidenceMetadata[] }> {
  return apiFetch(`/alerts/${alertId}/evidence`, { method: 'POST', token, body: { records } });
}

export function healthCheck(): Promise<{ ok: boolean; name: string; version: string }> {
  return apiFetch('/health');
}

export { ApiError };
