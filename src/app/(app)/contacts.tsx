/**
 * Emergency contacts management: add / edit / remove / verify.
 * Initial contacts are seeded from private local config at registration —
 * they are never hardcoded in public source files.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { EmergencyContact } from '@/core/types';
import { validateName, validatePhone } from '@/core/contacts/contacts';
import { useAuthStore } from '@/state/auth-store';
import { useContactsStore } from '@/state/contacts-store';
import { AppButton, Badge, Banner, Card, EmptyState, Field, Screen } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function ContactsScreen() {
  const token = useAuthStore((s) => s.token);
  const {
    contacts,
    loading,
    error,
    refresh,
    add,
    edit,
    remove,
    sendVerification,
    confirmVerification,
    pendingVerify,
    clearPendingVerify,
  } = useContactsStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  const openAdd = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setRelation('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (contact: EmergencyContact) => {
    setEditing(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setRelation(contact.relation ?? '');
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!token) return;
    const nameCheck = validateName(name);
    const phoneCheck = validatePhone(phone);
    if (!nameCheck.valid || !phoneCheck.valid) {
      setFormError(nameCheck.error ?? phoneCheck.error ?? 'Invalid contact');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await edit(token, editing.id, {
          name: name.trim(),
          phone: phoneCheck.normalized,
          relation: relation.trim() || undefined,
        });
      } else {
        await add(token, {
          name: name.trim(),
          phone: phoneCheck.normalized,
          relation: relation.trim() || undefined,
        });
      }
      setFormOpen(false);
    } catch {
      // store surfaces the error banner
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (contact: EmergencyContact) => {
    if (!token) return;
    setBusy(true);
    try {
      await remove(token, contact.id);
    } finally {
      setBusy(false);
    }
  };

  const onSendVerify = useCallback(
    async (contact: EmergencyContact) => {
      if (!token) return;
      await sendVerification(token, contact.id);
    },
    [sendVerification, token],
  );

  const onConfirmVerify = async (contact: EmergencyContact) => {
    if (!token || !verifyCode.trim()) return;
    setBusy(true);
    try {
      await confirmVerification(token, contact.id, verifyCode);
      setVerifyCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Emergency contacts"
      subtitle="These people receive your SOS alerts"
      footer={
        formOpen ? null : (
          <AppButton label="Add contact" onPress={openAdd} />
        )
      }
    >
      <Banner tone="info" title="Initial contacts">
        Your account was seeded with two initial emergency contacts from private local
        configuration. Verify them to activate delivery.
      </Banner>

      {error ? (
        <Banner tone="error" title="Contacts error">
          {error}
        </Banner>
      ) : null}

      {formOpen ? (
        <Card>
          <Text style={styles.formTitle}>{editing ? 'Edit contact' : 'New contact'}</Text>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Mom" />
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="9066384152 or +91…"
            hint="10-digit local number or international +<country><number>"
          />
          <Field label="Relation (optional)" value={relation} onChangeText={setRelation} placeholder="Family" />
          {formError ? (
            <Banner tone="error" title="Invalid input">
              {formError}
            </Banner>
          ) : null}
          <View style={styles.actions}>
            <AppButton label="Save" onPress={() => void submitForm()} loading={busy} style={{ flex: 1 }} />
            <AppButton
              label="Cancel"
              variant="secondary"
              onPress={() => setFormOpen(false)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      {contacts.length === 0 && !loading ? (
        <EmptyState text="No emergency contacts yet. Add at least one and verify it." />
      ) : null}

      {contacts.map((contact) => (
        <Card key={contact.id}>
          <View style={styles.contactHeader}>
            <Text style={styles.contactName}>{contact.name}</Text>
            <Badge
              label={contact.verified ? 'verified' : 'unverified'}
              tone={contact.verified ? colors.success : colors.warning}
            />
          </View>
          <Text style={styles.contactMeta}>
            {contact.phone}
            {contact.relation ? ` · ${contact.relation}` : ''}
          </Text>
          {!contact.verified ? (
            <View style={styles.actions}>
              <AppButton
                label="Send verification code"
                variant="secondary"
                onPress={() => void onSendVerify(contact)}
                style={{ flex: 2 }}
              />
              <AppButton
                label="Edit"
                variant="ghost"
                onPress={() => openEdit(contact)}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          {contact.verified ? (
            <View style={styles.actions}>
              <AppButton label="Edit" variant="ghost" onPress={() => openEdit(contact)} style={{ flex: 1 }} />
              <AppButton
                label="Remove"
                variant="danger"
                onPress={() => void onDelete(contact)}
                style={{ flex: 1 }}
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <AppButton
                label="Remove"
                variant="danger"
                onPress={() => void onDelete(contact)}
                style={{ flex: 1 }}
              />
            </View>
          )}

          {pendingVerify?.contactId === contact.id ? (
            <Card style={styles.verifyCard}>
              <Text style={styles.contactName}>
                Enter the 6-digit code{pendingVerify.delivery === 'mock' ? ' (mock mode)' : ' sent to the contact'}
              </Text>
              {pendingVerify.devCode ? (
                <Banner tone="warning" title="Dev mode code">
                  The backend is running with mock delivery, so the verification code is: {pendingVerify.devCode}
                </Banner>
              ) : (
                <Text style={styles.contactMeta}>
                  Delivery mode: {pendingVerify.delivery}. The contact should tell you the code they received.
                </Text>
              )}
              <Field
                label="Verification code"
                value={verifyCode}
                onChangeText={setVerifyCode}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="123456"
              />
              <View style={styles.actions}>
                <AppButton
                  label="Verify"
                  onPress={() => void onConfirmVerify(contact)}
                  loading={busy}
                  style={{ flex: 1 }}
                />
                <AppButton
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    clearPendingVerify();
                    setVerifyCode('');
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  formTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  contactHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contactName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  contactMeta: { color: colors.textMuted, fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  verifyCard: { backgroundColor: colors.surfaceAlt, marginTop: spacing.sm },
});
