  provider "digitalocean" {
    token = var.do_token
  }

  # Upload your SSH public key to DigitalOcean.
  # DigitalOcean will inject it into the server on creation.
  resource "digitalocean_ssh_key" "deploy" {
    name       = "finbot-deploy-key"
    public_key = var.ssh_public_key
  }

  # The server itself
  resource "digitalocean_droplet" "server" {
    name      = "finbot-prod"
    image     = "ubuntu-22-04-x64"
    size      = var.droplet_size
    region    = var.region
    ssh_keys  = [digitalocean_ssh_key.deploy.fingerprint]

    # This script runs once on first boot
    user_data = file("scripts/init.sh")

    tags = ["finbot", "production"]

    # user_data only runs on first boot. Ignore changes so editing init.sh
    # never causes an accidental destroy/recreate of the live server.
    lifecycle {
      ignore_changes = [user_data]
    }
  }