#!/bin/bash
set -euo pipefail

# ── System update ─────────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y

# ── Install Docker ─────────────────────────────────────────────────────────────
curl -fsSL https://get.docker.com | sh

# ── Create deploy user ────────────────────────────────────────────────────────
useradd -m -s /bin/bash -G docker deploy

# DigitalOcean injects SSH key into root — copy it to the deploy user
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# ── App directory ─────────────────────────────────────────────────────────────
mkdir -p /opt/finbot
chown deploy:deploy /opt/finbot

echo "FinBot server init complete"
