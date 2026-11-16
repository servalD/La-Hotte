// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { ConversationsModule } from './conversations.module';
/** NOT-13 : abonnés d'un élément, lus par `notifications`. */
export { FollowRepository } from './domain/conversation.ports';
