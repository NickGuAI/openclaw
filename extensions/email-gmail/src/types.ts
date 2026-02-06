export type EmailGmailAccountConfig = {
  fromAddress: string;
  fromName?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

export type EmailGmailChannelConfig = {
  enabled?: boolean;
  fromAddress?: string;
  fromName?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
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

export type ResolvedEmailGmailAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};
