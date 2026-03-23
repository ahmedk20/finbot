#!/bin/bash
set -euo pipefail

# Prevent any package installer from prompting for interactive input
export DEBIAN_FRONTEND=noninteractive

# ── System update ─────────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confold"

# ── Install Docker ─────────────────────────────────────────────────────────────
curl -fsSL https://get.docker.com | sh

# ── Enable Docker on boot ─────────────────────────────────────────────────────
systemctl enable docker
systemctl start docker

# ── Create deploy user ────────────────────────────────────────────────────────
useradd -m -s /bin/bash -G docker,sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

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
