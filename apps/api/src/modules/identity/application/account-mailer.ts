import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { IdentitySettings } from '../domain/account.ports';
import { type MailMessage, MailSender, RateLimiter } from '../domain/ports';

/**
 * Pages du web qui reçoivent un jeton (ADR 0013, « Liens envoyés par e-mail ») : le jeton est
 * dans le **fragment**, que le navigateur n'envoie à aucun serveur ; la page le poste dans le corps.
 */
export const EMAIL_LINK_PATHS = {
  verifyEmail: '/auth/verify-email',
  resetPassword: '/auth/reset-password',
  cancelEmailChange: '/auth/cancel-email-change',
} as const;

type MailKind =
  | { readonly kind: 'verify_email'; readonly token: string }
  | { readonly kind: 'confirm_email_change'; readonly token: string }
  | { readonly kind: 'email_change_notice'; readonly token: string }
  | { readonly kind: 'reset_password'; readonly token: string }
  | { readonly kind: 'registration_attempt' }
  | { readonly kind: 'email_taken_notice' }
  | { readonly kind: 'password_changed' }
  | { readonly kind: 'totp_enabled' }
  | { readonly kind: 'totp_disabled' }
  | { readonly kind: 'recovery_code_used' }
  | { readonly kind: 'second_factor_attempts' }
  | { readonly kind: 'google_linked' }
  | { readonly kind: 'google_unlinked' };

const SIGNATURE = '\n\n— La Hotte';

/**
 * E-mails du compte, en texte brut (invariant 6), sans aucun contenu d'utilisateur (ni nom ni
 * adresse dans le corps). Chaque envoi passe par le quota par destinataire (`01`, « Limitation ») :
 * au-delà, rien n'est envoyé et rien ne le signale, pour que la réponse ne dise rien d'un compte.
 */
@Injectable()
export class AccountMailer {
  constructor(
    private readonly sender: MailSender,
    private readonly limiter: RateLimiter,
    private readonly settings: IdentitySettings,
    private readonly clock: Clock,
  ) {}

  /** Vrai si l'e-mail est parti ; faux si le quota du destinataire est atteint. */
  async send(to: string, mail: MailKind): Promise<boolean> {
    // Quota par (destinataire, sorte) : épuiser les réinitialisations ne coupe pas l'avertissement
    // d'un changement d'e-mail, ni l'inverse (`01`, « Limitation »).
    const subjects = [{ scope: 'mail_recipient' as const, parts: [to, mail.kind] }];
    const now = this.clock.now();
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) return false;
    // Chaque envoi compte, qu'il réussisse ou non : un échec SMTP répété ne donne pas d'envoi de plus.
    await this.limiter.recordFailure(subjects, now, check.reservation);
    await this.sender.send(this.compose(to, mail));
    return true;
  }

  private link(path: string, token: string): string {
    return `${this.settings.webOrigin}${path}#${token}`;
  }

  private compose(to: string, mail: MailKind): MailMessage {
    switch (mail.kind) {
      case 'verify_email':
        return {
          to,
          subject: 'Confirmez votre adresse e-mail',
          text:
            'Bienvenue sur La Hotte.\n\nPour confirmer votre adresse e-mail, ouvrez ce lien ' +
            `(valable 7 jours) :\n${this.link(EMAIL_LINK_PATHS.verifyEmail, mail.token)}\n\n` +
            'Sans confirmation sous 7 jours, le compte est supprimé. Si vous n’êtes pas à ' +
            'l’origine de cette inscription, ignorez ce message.' +
            SIGNATURE,
        };
      case 'confirm_email_change':
        return {
          to,
          subject: 'Confirmez votre nouvelle adresse e-mail',
          text:
            'Pour utiliser cette adresse sur votre compte La Hotte, ouvrez ce lien (valable ' +
            `24 heures) :\n${this.link(EMAIL_LINK_PATHS.verifyEmail, mail.token)}\n\n` +
            'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.' +
            SIGNATURE,
        };
      case 'email_change_notice':
        return {
          to,
          subject: 'Changement d’adresse e-mail demandé',
          text:
            'Un changement de l’adresse e-mail de votre compte La Hotte a été demandé.\n\n' +
            'Si vous n’en êtes pas à l’origine, ouvrez ce lien (valable 7 jours) : il rétablit ' +
            'cette adresse, déconnecte tous les appareils et efface le mot de passe, que la ' +
            'personne qui a fait la demande connaît.\n' +
            `${this.link(EMAIL_LINK_PATHS.cancelEmailChange, mail.token)}\n\n` +
            'Vous recevrez ensuite un lien pour choisir un nouveau mot de passe.' +
            SIGNATURE,
        };
      case 'reset_password':
        return {
          to,
          subject: 'Réinitialisation de votre mot de passe',
          text:
            'Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes) :\n' +
            `${this.link(EMAIL_LINK_PATHS.resetPassword, mail.token)}\n\n` +
            'La réinitialisation déconnecte tous les appareils. Si vous n’êtes pas à l’origine ' +
            'de cette demande, ignorez ce message : votre mot de passe ne change pas.' +
            SIGNATURE,
        };
      case 'registration_attempt':
        return {
          to,
          subject: 'Tentative d’inscription avec votre adresse',
          text:
            'Quelqu’un a voulu créer un compte La Hotte avec cette adresse, qui en a déjà un. ' +
            'Aucun compte n’a été créé.\n\nSi c’était vous et que vous avez oublié votre mot de ' +
            `passe, réinitialisez-le :\n${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'password_changed':
        return {
          to,
          subject: 'Votre mot de passe a été changé',
          text:
            'Le mot de passe de votre compte La Hotte vient d’être changé, et les autres ' +
            'appareils ont été déconnectés.\n\nSi vous n’en êtes pas à l’origine, ' +
            'réinitialisez-le sans attendre :\n' +
            `${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'totp_enabled':
        return {
          to,
          subject: 'Double authentification activée',
          text:
            'La double authentification vient d’être activée sur votre compte La Hotte. Chaque ' +
            'connexion demandera désormais un code de votre application d’authentification.\n\n' +
            'Si vous n’en êtes pas à l’origine, réinitialisez votre mot de passe sans attendre :\n' +
            `${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'totp_disabled':
        return {
          to,
          subject: 'Double authentification désactivée',
          text:
            'La double authentification vient d’être désactivée sur votre compte La Hotte, et ' +
            'les autres appareils ont été déconnectés.\n\nSi vous n’en êtes pas à l’origine, ' +
            'réinitialisez votre mot de passe sans attendre :\n' +
            `${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'recovery_code_used':
        return {
          to,
          subject: 'Code de secours utilisé',
          text:
            'Un code de secours vient de servir à se connecter à votre compte La Hotte. Chaque ' +
            'code ne sert qu’une fois ; vous pouvez en générer de nouveaux dans votre espace ' +
            'Compte.\n\nSi vous n’en êtes pas à l’origine, réinitialisez votre mot de passe sans ' +
            `attendre :\n${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'second_factor_attempts':
        return {
          to,
          subject: 'Codes de double authentification erronés',
          text:
            'Plusieurs codes de double authentification erronés viennent d’être saisis sur votre ' +
            'compte La Hotte, après votre mot de passe : quelqu’un d’autre le connaît sans doute.' +
            '\n\nChangez-le sans attendre ; la réinitialisation déconnecte aussi tous les ' +
            `appareils :\n${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'google_linked':
        return {
          to,
          subject: 'Compte Google associé',
          text:
            'Un compte Google vient d’être associé à votre compte La Hotte : il permet désormais ' +
            'de s’y connecter.\n\nSi vous n’en êtes pas à l’origine, réinitialisez votre mot de ' +
            'passe, puis dissociez Google depuis votre espace Compte, ce qui déconnecte tous les ' +
            `appareils :\n${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'google_unlinked':
        return {
          to,
          subject: 'Compte Google dissocié',
          text:
            'Le compte Google associé à votre compte La Hotte vient d’en être dissocié, et les ' +
            'autres appareils ont été déconnectés.\n\nSi vous n’en êtes pas à l’origine, ' +
            'réinitialisez votre mot de passe sans attendre :\n' +
            `${this.settings.webOrigin}${EMAIL_LINK_PATHS.resetPassword}` +
            SIGNATURE,
        };
      case 'email_taken_notice':
        return {
          to,
          subject: 'Tentative d’utilisation de votre adresse',
          text:
            'Quelqu’un a voulu associer cette adresse à un autre compte La Hotte. Elle est déjà ' +
            'celle de votre compte : rien n’a changé.' +
            SIGNATURE,
        };
    }
  }
}
