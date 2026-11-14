// Ce que la présentation peut connaître du module (QA-03) : cas d'usage, ports servant de jetons
// d'injection, erreurs et règles nécessaires aux gardes.
export {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../domain/account';
export { CsrfTokens, SecretTokens, type SessionRef } from '../domain/ports';
export {
  hasRecentReauth,
  PIN_RELOCK_MODES,
  type PinRelock,
  REAUTH_MAX_AGE_MS,
  REAUTH_PIN_MAX_AGE_MS,
} from '../domain/session';
export {
  CURRENCY_PATTERN,
  LOCALE_PATTERN,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  type ProfileChanges,
  type ProfileDetails,
  type ProfileMetadata,
  TIMEZONE_MAX_LENGTH,
} from '../domain/profile';
export {
  CreateAccountProfile,
  DeleteAccountProfile,
  DisableProfilePin,
  ListAccountProfiles,
  ResetProfilePin,
  SetProfileChildMarker,
} from './manage-account-profiles.use-case';
export { GetOwnProfile, SetOwnPin, UpdateOwnProfile } from './manage-own-profile.use-case';
export { LockSession, type ProfileSelection, SelectProfile } from './select-profile.use-case';
export {
  CsrfRejectedError,
  ReauthRequiredError,
  SessionRequiredError,
} from '../domain/session.errors';
export {
  type ActiveProfile,
  AuthorizeProfile,
  type ProfileAccessState,
} from './authorize-profile.use-case';
export { CancelEmailChange } from './cancel-email-change.use-case';
export { ChangePassword } from './change-password.use-case';
export { CheckSessionAccess } from './check-session-access.use-case';
export type { ClientInfo } from './client-info';
export { ConfirmPasswordReset } from './confirm-password-reset.use-case';
export {
  ListSessions,
  RevokeSession,
  type SessionSummary,
  SignOut,
} from './manage-sessions.use-case';
export { CompleteGoogleFlow, type GoogleOutcome } from './complete-google-flow.use-case';
export { StartGoogleFlow } from './start-google-flow.use-case';
export { UnlinkGoogle } from './unlink-google.use-case';
export { PurgeUnverifiedAccounts } from './purge-unverified-accounts.use-case';
export { Reauthenticate } from './reauthenticate.use-case';
export { RegisterAccount } from './register-account.use-case';
export { ReportCsrfRejection } from './report-csrf-rejection.use-case';
export { RequestEmailChange } from './request-email-change.use-case';
export { RequestPasswordReset } from './request-password-reset.use-case';
export { ResolveSession, type ResolvedSession, sessionRef } from './resolve-session.use-case';
export { type IssuedSession, SessionLifecycle } from './session-lifecycle';
export { type SignInResult, SignInWithPassword } from './sign-in-with-password.use-case';
export { VerifyEmail } from './verify-email.use-case';
export { DisableTotp } from './disable-totp.use-case';
export { ActivateTotp, StartTotpEnrollment } from './enroll-totp.use-case';
export { type AccountSummary, GetAccount } from './get-account.use-case';
export {
  ListTrustedDevices,
  RevokeTrustedDevice,
  type TrustedDeviceView,
} from './manage-trusted-devices.use-case';
export { RegenerateRecoveryCodes } from './regenerate-recovery-codes.use-case';
export { type SecondFactorOutcome, VerifySecondFactor } from './verify-second-factor.use-case';
export { RECOVERY_CODE_COUNT } from '../domain/second-factor';
export { PENDING_SECOND_FACTOR_TTL_MS, TRUSTED_DEVICE_LIFETIME_MS } from '../domain/second-factor';
export { INVITATION_TOKEN_PATTERN } from '../domain/link';
export {
  ApproveLink,
  BlockProfile,
  BreakLink,
  CreateInvitation,
  type CreatedInvitation,
  InspectInvitation,
  type InvitationPreview,
  ListBlocks,
  ListCircle,
  ListInvitations,
  ListLinks,
  RedeemInvitation,
  RevokeInvitation,
  UnblockProfile,
} from './manage-links.use-case';
export type {
  BlockedProfile,
  CircleMember,
  LinkRole,
  LinkStatus,
  LinkView,
  OpenInvitation,
} from '../domain/link';
export { RemoveUnverifiedAccount } from './remove-unverified-account';
export {
  AttestAgeForRelease,
  CreateWard,
  CreateWardProfile,
  GetWard,
  ListWards,
  RequestWardRelease,
  ResetWardPassword,
  RevokeWardSessions,
  SetupWardAccount,
} from './manage-wards.use-case';
export type { WardSummary } from '../domain/ward';
export { ClearOwnEmail, SetOwnEmail, VerifyProfileEmail } from './profile-email.use-case';
export {
  AcceptProfileInvitation,
  DecideProfileProposal,
  InspectProfileInvitation,
  ListProfileProposals,
} from './profile-invitations.use-case';
