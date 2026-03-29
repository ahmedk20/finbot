# Server Commands Reference

Server IP: `104.236.35.121`
Domain: `finnbot.duckdns.org`
Deploy path: `/opt/finbot`

---

## SSH

```bash
# Login
ssh -i ~/.ssh/id_rsa deploy@104.236.35.121
```

---

## Environment Variables

```bash
# Edit finbot-api .env
sudo nano /opt/finbot/finbot-api/.env

# Edit trading-agents .env
sudo nano /opt/finbot/trading-agents/.env
```

---

## Docker — General

```bash
# View running containers
sudo docker compose -f docker-compose.prod.yml ps

# View logs for a service (last 50 lines)
sudo docker compose -f docker-compose.prod.yml logs <service> --tail=50

# Follow logs in real time
sudo docker compose -f docker-compose.prod.yml logs -f <service>

# Restart a single service (no rebuild, picks up .env changes)
sudo docker compose -f docker-compose.prod.yml restart <service>

# Recreate a container without rebuilding image (re-reads .env)
sudo docker compose -f docker-compose.prod.yml up -d --no-build <service>

# Run a command inside a running container
sudo docker compose -f docker-compose.prod.yml exec <service> <command>
```

Available services: `finbot-api`, `trading-agents`, `news-scraper`, `finbot-postgres`, `finbot-redis`, `finbot-rabbitmq`, `nginx`, `datadog-agent`

---

## Docker — Deploy New Code

After pushing code to GitHub and CI/CD builds new images:

```bash
cd /opt/finbot

# Pull latest images from GHCR
sudo docker compose -f docker-compose.prod.yml pull finbot-api trading-agents

# Recreate containers with new images
sudo docker compose -f docker-compose.prod.yml up -d finbot-api trading-agents
```

---

## Docker — Verify Environment Variables

```bash
# Print a specific env var from inside a container
sudo docker compose -f docker-compose.prod.yml exec trading-agents printenv OPENAI_API_KEY
sudo docker compose -f docker-compose.prod.yml exec finbot-api printenv DATABASE_URL
```

---

## Docker — Validate API Key (OpenAI)

```bash
sudo docker compose -f docker-compose.prod.yml exec trading-agents python -c "
import os
from openai import OpenAI
client = OpenAI(api_key=os.environ['OPENAI_API_KEY'])
r = client.chat.completions.create(model='gpt-4o-mini', messages=[{'role':'user','content':'ping'}], max_tokens=5)
print('OK:', r.choices[0].message.content)
"
```

---

## Prisma

```bash
# Run migrations (inside finbot-api container)
sudo docker compose -f docker-compose.prod.yml exec finbot-api npx prisma migrate deploy
```

---

## SSL / Certbot

```bash
# Renew SSL certificate manually
sudo docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot renew

# Check certificate expiry
sudo docker compose -f docker-compose.prod.yml exec nginx nginx -t
```

---

## Nginx

```bash
# Test nginx config
sudo docker compose -f docker-compose.prod.yml exec nginx nginx -t

# Reload nginx config (without downtime)
sudo docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```
