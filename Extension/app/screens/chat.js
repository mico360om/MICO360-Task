import { ChatInbox } from '../chat/inbox.js';
import { ChatThread } from '../chat/thread.js';

/**
 * Chat — two modes chosen by ctx.params.conversationId:
 *   inbox  (no id): favorites, project channels, direct messages and the archive (app/chat/inbox.js)
 *   thread (id)   : one conversation's messages and the message box (app/chat/thread.js)
 * Both read themselves again every few seconds while on screen, and at once when the tab is shown
 * again (`root.refresh`, called by app.js), without drawing what is being typed again (Stage 5).
 */
export function ChatScreen(ctx) {
  const conversationId = ctx.params.conversationId;
  return conversationId ? ChatThread(ctx, conversationId) : ChatInbox(ctx);
}
