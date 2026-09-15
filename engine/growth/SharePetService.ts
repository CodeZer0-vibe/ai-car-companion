import type { ShareContent, ShareOptions } from 'react-native';
import type { GrowthEngine } from '../GrowthEngine';
import type { RelationshipEngine } from '../RelationshipEngine';

interface NativeShareResult {
  action: string;
  activityType?: string | null;
}

interface SharePetServiceDeps {
  growthEngine: GrowthEngine | null;
  relationshipEngine: RelationshipEngine | null;
  share: (content: ShareContent, options?: ShareOptions) => Promise<NativeShareResult>;
  sharedAction: string;
  onEvent: (name: string, meta?: Record<string, unknown>) => void;
  onError: (scope: string, error: unknown) => void;
}

export async function sharePetInvite(deps: SharePetServiceDeps): Promise<void> {
  const { growthEngine, relationshipEngine, share, sharedAction, onEvent, onError } = deps;
  if (!growthEngine) return;

  const seed = relationshipEngine?.getSessionCount() ?? 0;
  const inviteCode = `${Date.now().toString(36)}${seed.toString(36)}`.slice(-10).toUpperCase();
  const payload = growthEngine.buildSharePayload(inviteCode);

  try {
    const result = await share({
      title: payload.title,
      message: payload.message,
    });
    onEvent('growth_share_sheet_result', { action: result.action, activityType: result.activityType ?? null });
    if (result.action === sharedAction) {
      await growthEngine.markShareSent();
      onEvent('growth_invite_sent', { channel: 'native_share' });
    }
  } catch (e) {
    onError('growth_share_failed', e);
  }
}
