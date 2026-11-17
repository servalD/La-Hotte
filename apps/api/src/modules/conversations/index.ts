// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { ConversationsModule } from './conversations.module';
/** NOT-13 : abonnés d'un élément, lus par `notifications`. */
export { FollowRepository } from './domain/conversation.ports';
/** MOD-07, MOD-08, MOD-10 : lisibilité d'un message pour un signaleur, et gestes de modération. */
export { type CommentForModeration, CommentModerationGate } from './application/comment-moderation';
