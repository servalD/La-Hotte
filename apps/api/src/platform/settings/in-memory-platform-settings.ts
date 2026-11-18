import {
  type AuditWrite,
  DEFAULT_PLATFORM_SETTINGS,
  type PlatformSettingKey,
  PlatformSettings,
  type PlatformSettingValues,
  type SettingWrite,
} from '../../shared/domain';

/** Double des tests : `audit` reçoit les entrées que la transaction aurait écrites. */
export class InMemoryPlatformSettings extends PlatformSettings {
  values: PlatformSettingValues = DEFAULT_PLATFORM_SETTINGS;

  constructor(private readonly audit: (write: AuditWrite) => void = () => undefined) {
    super();
  }

  current(): PlatformSettingValues {
    return this.values;
  }

  write<K extends PlatformSettingKey>(input: SettingWrite<K>): Promise<PlatformSettingValues[K]> {
    const before = this.values[input.key];
    this.audit(input.audit(before));
    this.values = { ...this.values, [input.key]: input.value };
    return Promise.resolve(before);
  }
}
