import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../../../platform/config/env';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { IdGenerator } from '../../../shared/domain';
import {
  type IdentityEvent,
  IdentityEvents,
  type IdentityEventListener,
  type MailMessage,
  MailSender,
  ProfileLockPolicies,
  SecurityLog,
} from '../domain/ports';
import type { ProfileLockPolicy } from '../domain/session';
import { pinStampOf } from './pin-stamp';

const USER_AGENT_MAX = 512;

/** SEC-30 : journal de sécurité en base, ajout seul (DAT-02, droits retirés par la migration). */
@Injectable()
export class PrismaSecurityLog extends SecurityLog {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdGenerator,
  ) {
    super();
  }

  async record(entry: Parameters<SecurityLog['record']>[0]): Promise<void> {
    await this.prisma.securityLog.create({
      data: {
        id: this.ids.next(),
        accountId: entry.accountId,
        event: entry.event,
        ip: entry.ip,
        userAgent: entry.userAgent.slice(0, USER_AGENT_MAX),
        at: entry.at,
      },
    });
  }
}

/** Réglage de verrouillage lu en base, limité au compte de la session (SEC-03). */
@Injectable()
export class PrismaProfileLockPolicies extends ProfileLockPolicies {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(accountId: string, profileId: string): Promise<ProfileLockPolicy | null> {
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, accountId },
      select: { id: true, accountId: true, pinHash: true, pinRelock: true },
    });
    return profile
      ? {
          profileId: profile.id,
          accountId: profile.accountId,
          hasPin: profile.pinHash !== null,
          relock: profile.pinRelock,
          pinStamp: pinStampOf(profile.pinHash),
        }
      : null;
  }
}

/**
 * Envoi SMTP (nodemailer ; Mailpit en local). Texte brut seulement. Ni l'adresse, ni le sujet,
 * ni le corps ne sont journalisés ; une erreur d'envoi remonte sans son message (il peut citer
 * l'adresse).
 */
@Injectable()
export class SmtpMailSender extends MailSender implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfig) {
    super();
    this.transporter = createTransport(config.env.SMTP_URL);
    this.from = config.env.MAIL_FROM;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch {
      throw new Error('Envoi d’e-mail impossible');
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}

/**
 * Événements internes en mémoire du processus. Un abonné qui échoue n'empêche ni la révocation ni
 * les autres abonnés ; l'erreur est journalisée (contenu retiré par `scrub`).
 */
@Injectable()
export class InProcessIdentityEvents extends IdentityEvents {
  private readonly logger = new Logger(InProcessIdentityEvents.name);
  private readonly listeners = new Set<IdentityEventListener>();

  publish(event: IdentityEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error({ err: error, event: event.type }, 'Abonné d’événement en échec');
      }
    }
  }

  subscribe(listener: IdentityEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
