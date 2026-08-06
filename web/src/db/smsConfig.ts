import { withTenant } from "./client";
import { writeAudit, type AuditValue } from "./audit";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/secretBox";
import type { SmsCredentials, SmsProviderId } from "@/notify/smsProviders";

export type SmsPatternConfig = { patternCode: string; paramNames?: string };
export const SMS_NOTIFICATION_TYPES = ["restock", "waitlist_offer", "password_reset", "team_invite", "agent_invite"] as const;

type StoredSecrets = { apiKey?: string; username?: string; password?: string }; // apiKey/password رمزنگاری‌شده در DB
type StoredConfig = {
  enabled: boolean;
  provider: SmsProviderId | null;
  senderNumber: string;
  patterns: Partial<Record<string, SmsPatternConfig>>;
} & StoredSecrets;

/** نمایی که به UI برمی‌گردد — apiKey/password هرگز خام نمی‌آیند، فقط ماسک‌شده. */
export type SmsConfigView = {
  enabled: boolean;
  provider: SmsProviderId | null;
  senderNumber: string;
  username: string | null;
  apiKeyMasked: string | null;
  passwordMasked: string | null;
  patterns: Partial<Record<string, SmsPatternConfig>>;
};

const EMPTY: StoredConfig = { enabled: false, provider: null, senderNumber: "", patterns: {} };

export async function getSmsConfig(tenantId: string): Promise<SmsConfigView> {
  const cfg = await readConfig(tenantId);
  return {
    enabled: cfg.enabled, provider: cfg.provider, senderNumber: cfg.senderNumber,
    username: cfg.username ?? null,
    apiKeyMasked: cfg.apiKey ? maskSecret(decryptSecret(cfg.apiKey)) : null,
    passwordMasked: cfg.password ? maskSecret(decryptSecret(cfg.password)) : null,
    patterns: cfg.patterns,
  };
}

/** فقط برای worker (sender.ts) — رازها را رمزگشایی‌شده برمی‌گرداند. کلاینت هرگز این را نمی‌بیند. */
export async function getSmsConfigForSending(
  tenantId: string,
): Promise<{ enabled: boolean; credentials: SmsCredentials; patterns: Partial<Record<string, SmsPatternConfig>> } | null> {
  const cfg = await readConfig(tenantId);
  if (!cfg.provider) return null;
  return {
    enabled: cfg.enabled,
    credentials: {
      provider: cfg.provider,
      apiKey: cfg.apiKey ? decryptSecret(cfg.apiKey) : undefined,
      username: cfg.username,
      password: cfg.password ? decryptSecret(cfg.password) : undefined,
      senderNumber: cfg.senderNumber,
    },
    patterns: cfg.patterns,
  };
}

async function readConfig(tenantId: string): Promise<StoredConfig> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx<{ smsConfig: StoredConfig | null }[]>`
      SELECT sms_config AS "smsConfig" FROM tenant WHERE id = ${tenantId}`;
    return row?.smsConfig ?? EMPTY;
  });
}

/**
 * ویرایشِ تنظیماتِ پیامک، با ردپا در دفترِ تغییرات — همان الگوی tenant_settings.edit.
 * رازها (apiKey/password) هیچ‌وقت در audit_log نمی‌روند، فقط این‌که عوض شدند یا نه.
 * قرارداد: `undefined` یعنی دست‌نخورده بماند، `""` یعنی پاک شود.
 */
export async function updateSmsConfig(p: {
  tenantId: string; actorUserId: string;
  enabled?: boolean; provider?: SmsProviderId | null; senderNumber?: string;
  apiKey?: string; username?: string; password?: string;
  patterns?: Partial<Record<string, SmsPatternConfig>>;
}) {
  await withTenant(p.tenantId, async (tx) => {
    const [row] = await tx<{ smsConfig: StoredConfig | null }[]>`
      SELECT sms_config AS "smsConfig" FROM tenant WHERE id = ${p.tenantId} FOR UPDATE`;
    const before = row?.smsConfig ?? EMPTY;

    const next: StoredConfig = {
      enabled: p.enabled ?? before.enabled,
      provider: p.provider === undefined ? before.provider : p.provider,
      senderNumber: p.senderNumber ?? before.senderNumber,
      username: p.username === undefined ? before.username : (p.username || undefined),
      apiKey: p.apiKey === undefined ? before.apiKey : (p.apiKey ? encryptSecret(p.apiKey) : undefined),
      password: p.password === undefined ? before.password : (p.password ? encryptSecret(p.password) : undefined),
      patterns: p.patterns ? { ...before.patterns, ...p.patterns } : before.patterns,
    };

    await tx`UPDATE tenant SET sms_config = ${tx.json(next)} WHERE id = ${p.tenantId}`;

    const oldDiff: Record<string, AuditValue> = {}, newDiff: Record<string, AuditValue> = {};
    const track = (key: string, oldVal: AuditValue, newVal: AuditValue) => {
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) { oldDiff[key] = oldVal; newDiff[key] = newVal; }
    };
    track("enabled", before.enabled, next.enabled);
    track("provider", before.provider, next.provider);
    track("senderNumber", before.senderNumber, next.senderNumber);
    // خودِ اشیاءِ پترن/راز در دفترِ تغییرات نمی‌رود (نه خوانا، نه امن)؛ فقط این‌که عوض شد یا نه.
    if (JSON.stringify(before.patterns) !== JSON.stringify(next.patterns)) track("patterns", "—", "تغییر کرد");
    if (p.apiKey !== undefined || p.username !== undefined || p.password !== undefined)
      track("credentials", "—", "تغییر کرد"); // مقدارِ خودِ راز هرگز ثبت نمی‌شود

    if (Object.keys(newDiff).length)
      await writeAudit(tx, {
        tenantId: p.tenantId, actorUserId: p.actorUserId, action: "sms_config.edit",
        entity: "tenant", entityId: p.tenantId, oldValue: oldDiff, newValue: newDiff,
      });
  });
}
