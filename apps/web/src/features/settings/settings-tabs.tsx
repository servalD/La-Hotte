'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationPreferencesSection } from '@/features/notifications/preferences-section';
import { MyDataSection } from './my-data';
import { MyModerationSection } from './my-moderation';
import { PinEmailSection } from './pin-email-section';
import { SettingsForm } from './settings-form';

/** Réglages du profil par rubriques : une page, quatre onglets, au lieu d'une colonne de 2 000 px. */
export function SettingsTabs() {
  const t = useTranslations('settings.tabs');
  return (
    <Tabs defaultValue="profile">
      <TabsList aria-label={t('label')}>
        <TabsTrigger value="profile">{t('profile')}</TabsTrigger>
        <TabsTrigger value="security">{t('security')}</TabsTrigger>
        <TabsTrigger value="notifications">{t('notifications')}</TabsTrigger>
        <TabsTrigger value="data">{t('data')}</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <SettingsForm />
      </TabsContent>
      <TabsContent value="security">
        <PinEmailSection />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationPreferencesSection />
      </TabsContent>
      <TabsContent value="data">
        <MyModerationSection />
        <MyDataSection />
      </TabsContent>
    </Tabs>
  );
}
