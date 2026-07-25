/** Minimal LINE Messaging API / Webhook types used by this project. */

export interface LineTextMessage {
  type: 'text';
  text: string;
}

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: unknown;
}

export type LineMessage = LineTextMessage | LineFlexMessage;

export interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LinePostbackEvent {
  type: 'postback';
  mode?: string;
  replyToken?: string;
  webhookEventId?: string;
  source: LineSource;
  postback: { data: string; params?: Record<string, string> };
  timestamp: number;
}

export interface LineGenericEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: LineSource;
  timestamp?: number;
}

export type LineWebhookEvent = LinePostbackEvent | LineGenericEvent;

export interface LineWebhookBody {
  destination?: string;
  events: LineWebhookEvent[];
}

/** Result of a call to the LINE Messaging API. */
export interface LineApiResult {
  ok: boolean;
  status: number;
  /** Safe-to-log error summary (never contains tokens/secrets). */
  error?: string;
}
