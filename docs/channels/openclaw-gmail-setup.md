# Email Channel Setup — Athena (OpenClaw)

Enable email-based agent conversations on `athena.gehirn.ai`. Receive emails via Gmail hooks, reply via **AWS SES** (using EC2 instance IAM role) or **Gmail API**.

---

## Infrastructure

| Component              | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| **AWS Account**        | `182399726409`                                                |
| **Region**             | `us-east-1`                                                   |
| **VPC**                | `vpc-0fecea10aeb38a0f3`                                       |
| **EC2 Instance**       | `i-0912605803fda6f1a`                                         |
| **EC2 Private IP**     | `172.31.25.152`                                               |
| **EC2 Subnet**         | `subnet-093864cf0f66d2960` (us-east-1c)                       |
| **EC2 Security Group** | `sg-0fee28b0160a5541d`                                        |
| **EC2 IAM Role**       | `dev-core`                                                    |
| **Domain**             | `athena.gehirn.ai`                                            |
| **DNS**                | Route 53 (gehirn.ai hosted zone)                              |
| **Existing ALB**       | Serves `legion.gehirn.ai` (IPs: 34.226.80.63, 100.28.146.240) |
| **Gateway port**       | `18789`                                                       |
| **OpenClaw source**    | `/home/ec2-user/App/openclaw`                                 |
| **Config**             | `~/.openclaw/openclaw.json`                                   |

---

## Architecture

```
Gmail Inbox
  | (Pub/Sub push notification)
  v
Google Pub/Sub
  | (push to https://athena.gehirn.ai/hooks/gmail)
  v
Route 53 (athena.gehirn.ai -> ALB alias)
  v
ALB (HTTPS :443, ACM cert)
  | (listener rule: Host=athena.gehirn.ai -> athena-tg)
  v
Target Group: athena-tg (HTTP :18789)
  | (health check: /health)
  v
EC2 i-0912605803fda6f1a (172.31.25.152:18789)
  v
OpenClaw Gateway
  | (hooks handler -> gmail-transform.ts)
  v
Agent Turn -> Outbound Adapter
  v
AWS SES SendRawEmail  -OR-  Gmail API messages.send
  v
Recipient Inbox
```

---

## Current State

| Component                       | Status              | Action Needed                           |
| ------------------------------- | ------------------- | --------------------------------------- |
| Node.js v24.5.0                 | Good                | None                                    |
| pnpm 10.26.2                    | Good                | None                                    |
| VPC `vpc-0fecea10aeb38a0f3`     | Exists              | None                                    |
| EC2 instance                    | Running             | None                                    |
| Existing ALB (legion)           | Running             | Reuse — add listener rule               |
| ACM cert for `athena.gehirn.ai` | **Missing**         | Create in ACM                           |
| Target group for gateway        | **Missing**         | Create `athena-tg` on port 18789        |
| ALB listener rule               | **Missing**         | Route `athena.gehirn.ai` -> `athena-tg` |
| Route 53 record                 | **Missing**         | A record alias -> ALB                   |
| Security group rule             | **May need update** | Allow ALB -> EC2 on port 18789          |
| IAM SES permissions             | **Missing**         | Add `ses:SendRawEmail` to `dev-core`    |
| SES verified identity           | **Missing**         | Verify `gehirn.ai` domain or email      |
| gog CLI                         | **Not installed**   | `npm i -g gog`                          |
| Gmail OAuth                     | **Not configured**  | `gog auth login`                        |
| OpenClaw email config           | **Not configured**  | Edit `openclaw.json`                    |

---

## Step 1: ACM Certificate for `athena.gehirn.ai`

The ALB needs a TLS certificate. ACM provides free certificates that auto-renew.

1. Open [ACM Console](https://console.aws.amazon.com/acm/home?region=us-east-1) (region: **us-east-1** — must match ALB region).
2. Click **Request a certificate**.
3. Certificate type: **Request a public certificate**. Click **Next**.
4. Domain name: `athena.gehirn.ai`
5. Validation method: **DNS validation** (recommended).
6. Click **Request**.
7. On the certificate details page, expand the domain row. You'll see a CNAME record to add.
8. Click **Create records in Route 53** (if your hosted zone is in the same account, this is a one-click button).
   - If the button doesn't appear, manually add the CNAME in Route 53:
     ```
     Name:  _<hash>.athena.gehirn.ai
     Type:  CNAME
     Value: _<hash>.acm-validations.aws
     ```
9. Wait for status to change from **Pending validation** to **Issued** (usually 5–30 minutes).

**Do NOT proceed until the certificate shows "Issued".**

Note the **Certificate ARN** — you'll need it in Step 4. It looks like:

```
arn:aws:acm:us-east-1:182399726409:certificate/<uuid>
```

---

## Step 2: Target Group — `athena-tg`

The target group tells the ALB where to forward traffic for Athena.

1. Open [EC2 Console > Target Groups](https://console.aws.amazon.com/ec2/home?region=us-east-1#TargetGroups).
2. Click **Create target group**.
3. Configure:

| Setting           | Value                   |
| ----------------- | ----------------------- |
| Target type       | **Instances**           |
| Target group name | `athena-tg`             |
| Protocol          | **HTTP**                |
| Port              | `18789`                 |
| VPC               | `vpc-0fecea10aeb38a0f3` |
| Protocol version  | **HTTP1**               |

4. Health check settings:

| Setting               | Value        |
| --------------------- | ------------ |
| Health check protocol | **HTTP**     |
| Health check path     | `/health`    |
| Healthy threshold     | `2`          |
| Unhealthy threshold   | `3`          |
| Timeout               | `5` seconds  |
| Interval              | `30` seconds |
| Success codes         | `200`        |

5. Click **Next**.
6. **Register targets**: Select instance `i-0912605803fda6f1a`, port `18789`. Click **Include as pending below**.
7. Click **Create target group**.

---

## Step 3: Security Group — Allow ALB to reach port 18789

The ALB needs to connect to the EC2 instance on port 18789. You need to allow this in the instance's security group.

1. Open [EC2 Console > Security Groups](https://console.aws.amazon.com/ec2/home?region=us-east-1#SecurityGroups).
2. Find the **ALB's security group** — go to the existing ALB (the one serving `legion.gehirn.ai`), click its **Security** tab, and note its security group ID.
3. Find the **EC2 instance's security group**: `sg-0fee28b0160a5541d`.
4. Edit the inbound rules for `sg-0fee28b0160a5541d`. Add:

| Type       | Protocol | Port range | Source                                   | Description           |
| ---------- | -------- | ---------- | ---------------------------------------- | --------------------- |
| Custom TCP | TCP      | `18789`    | ALB security group ID (e.g. `sg-xxxxxx`) | ALB to Athena gateway |

If the ALB and EC2 share the same security group, add a self-referencing rule:

| Type       | Protocol | Port range | Source                 | Description           |
| ---------- | -------- | ---------- | ---------------------- | --------------------- |
| Custom TCP | TCP      | `18789`    | `sg-0fee28b0160a5541d` | ALB to Athena gateway |

5. Click **Save rules**.

---

## Step 4: ALB Listener Rule — Route `athena.gehirn.ai`

Add a rule to the existing ALB's HTTPS listener to forward `athena.gehirn.ai` traffic to `athena-tg`.

### 4a. Find the existing ALB

1. Open [EC2 Console > Load Balancers](https://console.aws.amazon.com/ec2/home?region=us-east-1#LoadBalancers).
2. Find the ALB that serves `legion.gehirn.ai` (check DNS name or listener rules).

### 4b. Add the ACM cert to the HTTPS listener

1. Select the ALB. Click the **Listeners** tab.
2. Select the **HTTPS:443** listener. Click **View/edit certificates** (or **Manage certificates**).
3. Click **Add certificate**.
4. Select the ACM certificate for `athena.gehirn.ai` (from Step 1).
5. Click **Add**.

### 4c. Add a forwarding rule

1. Back on the **Listeners** tab, select the **HTTPS:443** listener. Click **View/edit rules** (or **Manage rules**).
2. Click **Add rule** (or the **+** icon).
3. Set a name: `athena-forward`.
4. **Condition**: Add condition > **Host header** > Value: `athena.gehirn.ai`
5. **Action**: Forward to target group > Select `athena-tg`.
6. Set priority (any number lower than the default rule, e.g. `10`).
7. Click **Save** / **Create**.

### 4d. Verify the HTTP listener (optional redirect)

If the ALB has an **HTTP:80** listener, make sure it has a redirect rule to HTTPS. This is usually already configured. If not:

1. Select the HTTP:80 listener.
2. Add/edit the default rule: **Redirect to HTTPS:443** (status code 301).

---

## Step 5: Route 53 — DNS Alias Record

Point `athena.gehirn.ai` to the ALB (not the EC2 IP directly).

1. Open [Route 53 Console](https://console.aws.amazon.com/route53/v2/hostedzones).
2. Click the `gehirn.ai` hosted zone.
3. Click **Create record**.
4. Configure:

| Setting          | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Record name      | `athena`                                             |
| Record type      | **A**                                                |
| Alias            | **Yes** (toggle on)                                  |
| Route traffic to | **Alias to Application and Classic Load Balancer**   |
| Region           | **US East (N. Virginia) [us-east-1]**                |
| Load balancer    | Select the ALB (same one serving `legion.gehirn.ai`) |
| Routing policy   | **Simple routing**                                   |

5. Click **Create records**.

**Verify DNS** (may take a few minutes):

```bash
dig +short athena.gehirn.ai A
# Should return the ALB IPs (same as legion.gehirn.ai), NOT 54.197.159.201
```

**Verify HTTPS** (gateway doesn't need to be running yet — ALB will return 502/503):

```bash
curl -sI https://athena.gehirn.ai
# Should get an HTTP response (502 is fine), NOT a TLS/connection error
```

---

## Step 6: IAM — Add SES Permissions to `dev-core` Role

Skip this step if using `email-gmail` outbound instead of SES.

1. Open [IAM Console > Roles](https://console.aws.amazon.com/iam/home#/roles).
2. Search for and select the `dev-core` role.
3. Click **Add permissions > Attach policies**.
4. Option A — **Managed policy** (quick): Search for `AmazonSESFullAccess`, select it, click **Add permissions**.
5. Option B — **Scoped inline policy** (more secure): Click **Add permissions > Create inline policy**, use JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AthenaEmailSend",
      "Effect": "Allow",
      "Action": ["ses:SendRawEmail", "ses:GetSendQuota", "ses:GetAccount"],
      "Resource": "*"
    }
  ]
}
```

Name it `athena-ses-send`. Click **Create policy**.

**Verify from the EC2 instance:**

```bash
aws ses get-send-quota --region us-east-1
```

Expected: JSON with `Max24HourSend`, `SentLast24Hours`, `MaxSendRate`. If access denied, the policy isn't attached or needs time to propagate.

---

## Step 7: SES — Verify Sending Identity

You need a verified domain or email address in SES to send from.

### 7a. Verify domain (recommended)

1. Open [SES Console](https://console.aws.amazon.com/ses/home?region=us-east-1) > **Verified Identities**.
2. Click **Create identity**.
3. Identity type: **Domain**.
4. Domain: `gehirn.ai`
5. Click **Create identity**.
6. SES shows DKIM CNAME records to add. If Route 53 is in the same account, click **Publish DNS records to Route 53** for one-click setup.
7. Otherwise, manually add the 3 CNAME records to your Route 53 `gehirn.ai` hosted zone.
8. Wait for status to change to **Verified** (usually 5–15 minutes).

### 7b. Check sandbox status

```bash
aws ses get-account --region us-east-1
```

If `"ProductionAccessEnabled": false`, you're in the SES **sandbox** and can only send to verified email addresses. To send to anyone:

1. SES Console > **Account dashboard** > **Request production access**.
2. Fill out the request form (use case, expected volume, etc.).
3. Wait for approval (usually 24 hours).

For testing while in sandbox, verify recipient email addresses:

1. SES Console > **Verified Identities** > **Create identity** > **Email address**.
2. Enter the test recipient email. They'll get a verification link.

### 7c. Test SES send

```bash
aws ses send-email \
  --from "athena@gehirn.ai" \
  --destination 'ToAddresses=["YOUR_TEST_EMAIL"]' \
  --message 'Subject={Data="Athena SES Test"},Body={Text={Data="Hello from Athena"}}' \
  --region us-east-1
```

---

## Step 8: Install `gog` CLI

```bash
npm install -g gog
```

**Verify:**

```bash
gog --version
```

---

## Step 9: GCP — Gmail API + Pub/Sub

### 9a. Enable APIs

1. [Google Cloud Console](https://console.cloud.google.com/) > Select or create a project.
2. **APIs & Services > Library** > Enable:
   - **Gmail API**
   - **Cloud Pub/Sub API**

### 9b. Create OAuth credentials

1. **APIs & Services > Credentials** > **Create Credentials > OAuth client ID**.
2. Application type: **Desktop app**.
3. Name: `athena-gmail-watcher`.
4. Click **Create**. Note the `client_id` and `client_secret`.

### 9c. Create Pub/Sub topic

1. **Pub/Sub > Topics** > **Create Topic**.
2. Topic ID: `assistant-gmail-watch`.
3. Click **Create**.

### 9d. Grant Gmail publish permission

1. Select the `assistant-gmail-watch` topic.
2. **Permissions** > **Add Principal**.
3. Principal: `gmail-api-push@system.gserviceaccount.com`
4. Role: **Pub/Sub Publisher**.
5. **Save**.

### 9e. Create push subscription

1. **Pub/Sub > Subscriptions** > **Create Subscription**.
2. Subscription ID: `assistant-gmail-watch-push`.
3. Topic: `assistant-gmail-watch`.
4. Delivery type: **Push**.
5. Endpoint URL: `https://athena.gehirn.ai/hooks/gmail`
6. **Create**.

---

## Step 10: Gmail OAuth — Authenticate `gog`

```bash
gog auth login
```

Log in with the Gmail account you want to monitor. Credentials are stored at `~/.config/gogcli/credentials.json`.

**If using `email-gmail` outbound**, you need the `gmail.send` scope:

```bash
gog auth login --scopes gmail.readonly,gmail.modify,gmail.send
```

**Verify:**

```bash
gog gmail watch start YOUR_EMAIL@gmail.com --topic assistant-gmail-watch
```

---

## Step 11: Build OpenClaw

```bash
cd /home/ec2-user/App/openclaw
pnpm install
pnpm build
```

---

## Step 12: Configure OpenClaw

Edit `~/.openclaw/openclaw.json`. Merge these sections into the existing config — do NOT replace existing keys.

### 12a. Generate tokens

```bash
# Hooks auth token
openssl rand -hex 32
# -> Copy output, this is YOUR_HOOKS_TOKEN

# Pub/Sub push verification token
openssl rand -hex 16
# -> Copy output, this is YOUR_PUSH_TOKEN
```

### 12b. Add email channel to `channels`

**For email-ses (AWS SES):**

```jsonc
"email-ses": {
  "enabled": true,
  "fromAddress": "athena@gehirn.ai",
  "fromName": "Athena",
  "region": "us-east-1",
  "dmHistoryLimit": 30
}
```

**For email-gmail (Gmail API):**

```jsonc
"email-gmail": {
  "enabled": true,
  "fromAddress": "YOUR_EMAIL@gmail.com",
  "fromName": "Athena",
  "dmHistoryLimit": 30
}
```

### 12c. Add Gmail hooks to `hooks`

Merge into the existing `hooks` section (which already has `hooks.internal`):

```jsonc
"enabled": true,
"token": "YOUR_HOOKS_TOKEN",
"gmail": {
  "account": "YOUR_EMAIL@gmail.com",
  "topic": "assistant-gmail-watch",
  "subscription": "assistant-gmail-watch-push",
  "pushToken": "YOUR_PUSH_TOKEN",
  "hookUrl": "https://athena.gehirn.ai/hooks/gmail",
  "serve": {
    "bind": "127.0.0.1",
    "port": 8788,
    "path": "/gmail-pubsub"
  }
},
"mappings": [
  {
    "id": "gmail-email-session",
    "match": { "path": "gmail" },
    "action": "agent",
    "transform": {
      "module": "./extensions/email-ses/src/gmail-transform.js"
    }
  }
]
```

For email-gmail outbound, change the transform module to:

```
"module": "./extensions/email-gmail/src/gmail-transform.js"
```

### 12d. Enable the plugin in `plugins.entries`

```jsonc
"email-ses": { "enabled": true }
```

Or for email-gmail:

```jsonc
"email-gmail": { "enabled": true }
```

### 12e. Change gateway bind mode

The ALB connects to the EC2 private IP (`172.31.25.152`), NOT localhost. The gateway must bind to the network interface, not loopback.

Change `gateway.bind` from `"loopback"` to `"lan"`:

```jsonc
"gateway": {
  "port": 18789,
  "mode": "local",
  "bind": "lan",
  // ... rest unchanged ...
}
```

### 12f. Full merged config (email-ses example)

```jsonc
{
  // ... existing meta, wizard, auth, agents, messages, commands unchanged ...

  "hooks": {
    "enabled": true,
    "token": "YOUR_HOOKS_TOKEN",
    "internal": {
      "enabled": true,
      "entries": {
        "session-memory": { "enabled": true },
        "command-logger": { "enabled": true },
        "boot-md": { "enabled": true },
      },
    },
    "gmail": {
      "account": "YOUR_EMAIL@gmail.com",
      "topic": "assistant-gmail-watch",
      "subscription": "assistant-gmail-watch-push",
      "pushToken": "YOUR_PUSH_TOKEN",
      "hookUrl": "https://athena.gehirn.ai/hooks/gmail",
      "serve": {
        "bind": "127.0.0.1",
        "port": 8788,
        "path": "/gmail-pubsub",
      },
    },
    "mappings": [
      {
        "id": "gmail-email-session",
        "match": { "path": "gmail" },
        "action": "agent",
        "transform": {
          "module": "./extensions/email-ses/src/gmail-transform.js",
        },
      },
    ],
  },

  "channels": {
    "whatsapp": {
      // ... existing whatsapp config unchanged ...
    },
    "imessage": {
      // ... existing imessage config unchanged ...
    },
    "email-ses": {
      "enabled": true,
      "fromAddress": "athena@gehirn.ai",
      "fromName": "Athena",
      "region": "us-east-1",
      "dmHistoryLimit": 30,
    },
  },

  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "lan",
    "auth": {
      // ... existing auth unchanged ...
    },
    "tailscale": {
      // ... existing tailscale unchanged ...
    },
  },

  "plugins": {
    "entries": {
      "imessage": { "enabled": true },
      "whatsapp": { "enabled": true },
      "lobstercage": { "enabled": true, "config": {} },
      "email-ses": { "enabled": true },
    },
  },

  // ... existing skills unchanged ...
}
```

---

## Step 13: Start the Gateway

### First run (foreground, to see logs):

```bash
cd /home/ec2-user/App/openclaw
pnpm openclaw gateway run
```

Watch the output for:

- `email-ses` (or `email-gmail`) channel showing as configured
- `gog gmail watch serve` starting on port 8788
- No errors about missing credentials or config

### Background (persistent):

```bash
pkill -9 -f "openclaw.*gateway" || true
cd /home/ec2-user/App/openclaw && nohup pnpm openclaw gateway run > /tmp/athena-gateway.log 2>&1 &
```

---

## Step 14: Verify Everything

Run these in order.

### 14a. Gateway is listening

```bash
ss -tlnp | grep 18789
# Expected: LISTEN on 0.0.0.0:18789 or :::18789
```

### 14b. Health check from localhost

```bash
curl -s http://localhost:18789/health
```

### 14c. ALB target is healthy

1. Open [EC2 Console > Target Groups](https://console.aws.amazon.com/ec2/home?region=us-east-1#TargetGroups).
2. Select `athena-tg`.
3. Click **Targets** tab.
4. Instance `i-0912605803fda6f1a` should show **healthy**.

If **unhealthy**: check security group allows ALB -> EC2 on 18789 (Step 3), and gateway is binding to `lan` not `loopback` (Step 12e).

### 14d. HTTPS through ALB

```bash
curl -s https://athena.gehirn.ai/health
```

Expected: JSON health response. If 502/503, target is unhealthy (see 14c). If TLS error, ACM cert isn't attached to listener (Step 4b).

### 14e. Email channel is registered

```bash
cd /home/ec2-user/App/openclaw
pnpm openclaw channels status --probe
```

Expected: `email-ses` (or `email-gmail`) appears as configured/running.

### 14f. Gmail watcher is running

```bash
ps aux | grep "gog gmail watch"
```

### 14g. Gateway logs

```bash
tail -n 100 /tmp/athena-gateway.log | grep -iE "email|gmail|hook|error"
```

### 14h. End-to-end test

1. Send an email to `YOUR_EMAIL@gmail.com` from a different address.
2. Watch logs:
   ```bash
   tail -f /tmp/athena-gateway.log
   ```
3. You should see:
   - Hook received from Gmail
   - Session created: `email:thread:<threadId>`
   - Agent processes the message
   - Outbound email sent via SES / Gmail API
4. Check sender's inbox for the agent's reply.

### 14i. Verify threading

1. Reply to the agent's email.
2. Agent should respond in the same thread with context.
3. Check delivery contexts:
   ```bash
   ls ~/.openclaw/email-ses/contexts/
   cat ~/.openclaw/email-ses/contexts/*.json
   ```

---

## Troubleshooting

| Issue                                                | What to check                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS not resolving for athena.gehirn.ai               | Check Route 53 alias record exists. `dig +short athena.gehirn.ai A` should return ALB IPs (same as `legion.gehirn.ai`).                                                 |
| TLS / certificate error                              | ACM cert not issued yet, or not attached to ALB HTTPS listener. Check ACM console for status. Check ALB listener has the cert (Step 4b).                                |
| `502 Bad Gateway`                                    | Target group unhealthy. Check: (1) gateway running on port 18789, (2) `bind: "lan"` in config (not `loopback`), (3) SG allows ALB -> EC2 on 18789.                      |
| `503 Service Unavailable`                            | No healthy targets in `athena-tg`. Register the instance (Step 2) and check health.                                                                                     |
| Target group shows **unhealthy**                     | Gateway isn't responding on `172.31.25.152:18789`. Verify `ss -tlnp \| grep 18789` shows `0.0.0.0:18789`. If it shows `127.0.0.1:18789`, change `bind` to `"lan"`.      |
| Email channel not in `channels status`               | Check `plugins.entries` has `"email-ses": { "enabled": true }`. Check `channels.email-ses.fromAddress` is set.                                                          |
| Inbound emails not triggering                        | Is `hooks.enabled: true`? Is `hooks.gmail.account` set? Is `gog gmail watch serve` running? Is Pub/Sub subscription pointing to `https://athena.gehirn.ai/hooks/gmail`? |
| `gog: command not found`                             | `npm install -g gog`. Check PATH.                                                                                                                                       |
| SES `AccessDenied`                                   | IAM role `dev-core` needs SES permissions (Step 6).                                                                                                                     |
| SES `MessageRejected: Email address is not verified` | Verify sending identity in SES (Step 7).                                                                                                                                |
| SES only sends to verified addresses                 | You're in SES sandbox. Request production access (Step 7b).                                                                                                             |
| Gmail token refresh failing                          | Re-run `gog auth login`. Check `~/.config/gogcli/credentials.json`.                                                                                                     |
| Hook transform not loading                           | `transform.module` path is relative to `~/.openclaw/`. May need full path: `/home/ec2-user/App/openclaw/extensions/email-ses/src/gmail-transform.js`.                   |

---

## Key Files

| File                                                     | Purpose                                        |
| -------------------------------------------------------- | ---------------------------------------------- |
| `~/.openclaw/openclaw.json`                              | OpenClaw runtime configuration                 |
| `~/.config/gogcli/credentials.json`                      | Gmail OAuth credentials                        |
| `~/.openclaw/email-ses/contexts/*.json`                  | Per-thread delivery context files              |
| `/tmp/athena-gateway.log`                                | Gateway log output                             |
| `/home/ec2-user/App/openclaw/extensions/email-ses/`      | SES email extension                            |
| `/home/ec2-user/App/openclaw/extensions/email-gmail/`    | Gmail email extension                          |
| `/home/ec2-user/App/openclaw/src/hooks/gmail-watcher.ts` | Starts `gog gmail watch serve` on gateway boot |

---

## Quick Reference: The 14 Steps

1. **ACM Certificate**: Request cert for `athena.gehirn.ai`, DNS-validate via Route 53
2. **Target Group**: Create `athena-tg` — HTTP, port 18789, health check `/health`, register instance
3. **Security Group**: Allow ALB SG -> `sg-0fee28b0160a5541d` on TCP 18789
4. **ALB Listener Rule**: Add cert to HTTPS listener, add rule Host=`athena.gehirn.ai` -> `athena-tg`
5. **Route 53**: A record alias `athena.gehirn.ai` -> ALB
6. **IAM**: Add `ses:SendRawEmail` to `dev-core` role (SES only)
7. **SES**: Verify `gehirn.ai` domain, check sandbox status (SES only)
8. **gog CLI**: `npm install -g gog`
9. **GCP**: Gmail API + Pub/Sub, topic, subscription -> `https://athena.gehirn.ai/hooks/gmail`
10. **Gmail OAuth**: `gog auth login`
11. **Build**: `cd /home/ec2-user/App/openclaw && pnpm install && pnpm build`
12. **Config**: Edit `~/.openclaw/openclaw.json` — email channel, hooks, plugin, `bind: "lan"`
13. **Start**: `pnpm openclaw gateway run`
14. **Verify**: Target healthy, HTTPS works, channel registered, send test email
