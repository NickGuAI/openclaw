# OpenClaw Email Channel — GCP Setup SOP

Google Cloud Platform setup for Gmail Pub/Sub push notifications to `athena.gehirn.ai`.

---

## Architecture

```
Gmail Inbox
  | (Gmail API watch → notification)
  v
Google Pub/Sub Topic: assistant-gmail-watch
  | (push subscription)
  v
https://athena.gehirn.ai/hooks/gmail
  v
OpenClaw Gateway (hooks handler)
```

---

## Prerequisites

- GCP project with billing enabled
- `gcloud` CLI installed and authenticated
- Gmail account to monitor
- `athena.gehirn.ai` HTTPS endpoint reachable (AWS side complete)

---

## Setup Script

Location: `/home/ec2-user/App/setup_gcp_gmail_pubsub.sh`

The script automates:

1. Enabling Gmail API and Pub/Sub API
2. Creating the Pub/Sub topic
3. Granting Gmail push permission to the topic
4. Creating the push subscription pointing to the webhook endpoint
5. Creating a service account for server-side operations

Run:

```bash
chmod +x /home/ec2-user/App/setup_gcp_gmail_pubsub.sh
./setup_gcp_gmail_pubsub.sh
```

---

## Manual Steps (after script)

### 1. OAuth Credentials for Gmail Watch

The Gmail `watch()` API requires user OAuth consent. Create OAuth credentials in GCP Console:

1. Go to **APIs & Services > Credentials**
2. **Create Credentials > OAuth client ID**
3. Application type: **Desktop app**
4. Name: `athena-gmail-watcher`
5. Download the JSON, save as `~/.openclaw/gmail-oauth-client.json`

### 2. Authenticate with gog CLI

```bash
# Install gog if not already installed
npm install -g gog

# Login with Gmail scopes
gog auth login --scopes gmail.readonly,gmail.modify,gmail.send

# Start the Gmail watch
gog gmail watch start athena@gehirn.ai --topic assistant-gmail-watch
```

### 3. Update OpenClaw Config

Add to `~/.openclaw/openclaw.json` under `hooks`:

```json
"enabled": true,
"token": "907ae8f8d96cc4f5b7362857b3e41e06272b2d372d06c01ee80e5af084e8f28a",
"gmail": {
  "account": "athena@gehirn.ai",
  "topic": "assistant-gmail-watch",
  "subscription": "assistant-gmail-watch-push",
  "pushToken": "0dee0a3497754865aa26a0dc612323ba",
  "hookUrl": "https://athena.gehirn.ai/hooks/gmail",
  "serve": {
    "bind": "127.0.0.1",
    "port": 8788,
    "path": "/gmail-pubsub"
  }
}
```

---

## Verification

```bash
# Check topic exists
gcloud pubsub topics describe assistant-gmail-watch

# Check subscription
gcloud pubsub subscriptions describe assistant-gmail-watch-push

# Check Gmail API enabled
gcloud services list --enabled --filter="name:gmail.googleapis.com"

# Check Pub/Sub API enabled
gcloud services list --enabled --filter="name:pubsub.googleapis.com"

# Test push (send email to the monitored account, watch gateway logs)
tail -f /tmp/athena-gateway.log | grep -i gmail
```

---

## Renewal

Gmail watch expires after 7 days. Set up a cron or systemd timer:

```bash
# Renew watch every 6 days
0 0 */6 * * /usr/bin/gog gmail watch start athena@gehirn.ai --topic assistant-gmail-watch
```

---

## Troubleshooting

| Issue                      | Check                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| No push notifications      | Is subscription endpoint `https://athena.gehirn.ai/hooks/gmail` reachable? Check ALB + target health |
| Permission denied on topic | Ensure `gmail-api-push@system.gserviceaccount.com` has Pub/Sub Publisher role on topic               |
| Watch expired              | Re-run `gog gmail watch start`. Set up cron for auto-renewal                                         |
| OAuth token expired        | Re-run `gog auth login`                                                                              |
| Push delivery failing      | Check Pub/Sub subscription metrics in GCP Console for error rates                                    |
