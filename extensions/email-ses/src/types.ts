export type EmailSesAccountConfig = {
  region?: string;
  fromAddress: string;
  fromName?: string;
  replyToAddress?: string;
};

export type EmailSesChannelConfig = {
  enabled?: boolean;
  accounts?: Record<string, EmailSesAccountConfig>;
  region?: string;
  fromAddress?: string;
  fromName?: string;
  replyToAddress?: string;
  allowFrom?: string[];
  dmHistoryLimit?: number;
};

export type EmailDeliveryContext = {
  messageId?: string;
  threadId: string;
  subject?: string;
  references?: string;
  from?: string;
};

export type ResolvedEmailSesAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};
