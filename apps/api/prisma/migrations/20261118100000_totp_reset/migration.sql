-- ADM-07 : lien de réinitialisation du TOTP déclenché par un administrateur.
ALTER TYPE "account_token_purpose" ADD VALUE 'TOTP_RESET';
